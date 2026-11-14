import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/**
 * A payment Aurora paid out but never listed as "received" (the real 4.99 USDC case: the merchant's wallet
 * got the money, the invoice expired, Tender had no record). Tender must find it in the payout lists and keep it.
 */

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

const MIN = 60_000;

async function invoice(amount = "49.00") {
  const m = await merchant(t.db);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: amount, currency: "USD", reference: `order_${Math.random()}`, chains: ["base", "solana"] },
  });
  const inv = res.json() as { id: string; expires_at: string; addresses: { chain: string; address: string }[] };
  const addr = (chain: string) => inv.addresses.find((a) => a.chain === chain)!.address;
  return { ...inv, evm: addr("base"), sol: addr("solana"), merchantId: m.merchant.id };
}

const status = async (id: string) => (await t.db.invoice.findUniqueOrThrow({ where: { id } })).status;
const payout = (address: string, dollars: number, at: Date, tx?: string) =>
  deposit(address, { asset: ASSETS.USDC_MONAD, amount: String(Math.round(dollars * 1e6)), at, tx });
const usdc = (address: string, dollars: number, at: Date, tx?: string) =>
  deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), at, tx });
const payments = (invoiceId: string) => t.db.payment.findMany({ where: { invoiceId }, orderBy: { firstSeenAt: "asc" } });
/** How many times the poller asked Aurora for a payout list (success or failed) on an address. */
const payoutListReads = (address: string) => t.aurora.deposits.mock.calls.filter(([a, type]) => a === address && type !== "received").length;

describe("a deposit Aurora paid out but never listed as received", () => {
  it("is recorded once from the payout list, and settles the invoice when the payout was inside the window", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();

    // Paid out 5 minutes after the invoice opened; `received` never shows it.
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8, new Date(deadline - 20 * MIN), "payout_tx_1"));
    clock.now = new Date(deadline + 16 * MIN);
    // Several polls see the same payout: it is recorded once.
    for (let i = 0; i < 3; i++) {
      await poller.tick();
      clock.now = new Date(clock.now.getTime() + 31 * MIN);
    }

    const rows = await payments(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SETTLED", outcomeTxHash: "payout_tx_1" });
    expect(rows[0]!.amountSettled?.toString()).toBe("48.8");
    expect(rows[0]!.raw).toMatchObject({ fromPayoutOnly: true });
    // Judged on what actually reached the merchant, so it is not left to expire.
    expect(await status(inv.id)).not.toBe("EXPIRED");
  });

  it("is recorded even when the payout came after the invoice had already closed", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();

    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");
    expect(await payments(inv.id)).toHaveLength(0);

    // 12 days later Aurora (or its support) pays it out. It must be on record.
    clock.now = new Date(deadline + 3 * 3_600_000);
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8, clock.now, "late_payout"));
    clock.now = new Date(clock.now.getTime() + 31 * MIN);
    await poller.tick();

    const rows = await payments(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "SETTLED", outcomeTxHash: "late_payout" });
    expect(rows[0]!.raw).toMatchObject({ fromPayoutOnly: true });
  });

  it("records a failed payout with no deposit as a failed payment with a recovery task", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();
    t.aurora.push(inv.evm, "failed", payout(inv.evm, 48.8, new Date(deadline - 20 * MIN), "failed_tx"));
    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();

    const rows = await payments(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "FAILED" });
    expect(await t.db.recoveryTask.count({ where: { paymentId: rows[0]!.id } })).toBe(1);
  });

  it("does not count the money twice when Aurora lists the deposit as received afterwards", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();
    const depositedAt = new Date(deadline - 30 * MIN);

    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8, new Date(deadline - 20 * MIN), "payout_x"));
    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();
    expect(await payments(inv.id)).toHaveLength(1);

    // Aurora catches up: the original deposit now appears.
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, depositedAt, "deposit_x"));
    clock.now = new Date(clock.now.getTime() + 31 * MIN);
    await poller.tick();

    const rows = await payments(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ auroraTxHash: "deposit_x", status: "SETTLED", outcomeTxHash: "payout_x" });
    expect(rows[0]!.amountIn.toString()).toBe("49");
  });

  it("does not read the payout lists while the invoice is still open, and reads them only sparingly after it closes", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();

    // Open window: ten polls, one Aurora call each (received only).
    for (let i = 0; i < 10; i++) {
      await poller.tick();
      clock.now = new Date(clock.now.getTime() + 10_000);
    }
    expect(payoutListReads(inv.evm)).toBe(0);

    // Just past the deadline: read once to be sure nothing was paid out, then closed.
    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");
    const afterClose = payoutListReads(inv.evm);
    expect(afterClose).toBeGreaterThan(0);

    // Ten more polls over ten minutes: closed, unpaid, must not triple the Aurora traffic.
    for (let i = 0; i < 10; i++) {
      clock.now = new Date(clock.now.getTime() + 61_000);
      await poller.tick();
    }
    expect(payoutListReads(inv.evm) - afterClose).toBeLessThanOrEqual(2);
  });
});
