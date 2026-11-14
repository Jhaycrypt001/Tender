import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** Money that arrives, or is only recorded, after an invoice has closed. */

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
  await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: amount, currency: "USD", reference: `order_${Math.random()}`, chains: ["base", "solana"] },
  });
  const inv = res.json() as { id: string; expires_at: string; addresses: { chain: string; address: string }[] };
  return { ...inv, evm: inv.addresses.find((a) => a.chain === "base")!.address, auth: m.auth };
}

const status = async (id: string) => (await t.db.invoice.findUniqueOrThrow({ where: { id } })).status;
const usdc = (address: string, dollars: number, at: Date) => deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), at });
const payout = (address: string, dollars: number, at: Date) => deposit(address, { asset: ASSETS.USDC_MONAD, amount: String(Math.round(dollars * 1e6)), at });
const hooks = async (invoiceId: string, event: string) => t.db.webhookDelivery.count({ where: { invoiceId, event } });

describe("money recorded after an invoice closed", () => {
  it("corrects an EXPIRED invoice when a deposit that arrived in time is only listed afterwards", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();

    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");

    // Aurora lists a deposit from inside the window only now.
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, new Date(deadline - 20 * MIN)));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8, new Date(deadline - 10 * MIN)));
    clock.now = new Date(clock.now.getTime() + 2 * MIN);
    await poller.tick();

    expect(await status(inv.id)).toBe("SETTLED");
    expect(await hooks(inv.id, "invoice.settled")).toBe(1);
  });

  it("tells the merchant about money that arrived after the window, once, without reopening the invoice", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();
    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");

    clock.now = new Date(clock.now.getTime() + 2 * MIN);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, clock.now));
    for (let i = 0; i < 3; i++) {
      await poller.tick();
      clock.now = new Date(clock.now.getTime() + 2 * MIN);
    }

    expect(await status(inv.id)).toBe("EXPIRED");
    expect(await t.db.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
    expect(await hooks(inv.id, "invoice.late_payment")).toBe(1);
  });

  it("does not announce a late payment a second time when its deposit is listed after its payout", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();
    clock.now = new Date(deadline + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");

    // Aurora lists only the payout at first (checked at most every 30 minutes once closed): a payment is recorded from it
    // alone, and announced.
    clock.now = new Date(clock.now.getTime() + 31 * MIN);
    const paidOutAt = clock.now;
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8, paidOutAt));
    await poller.tick();
    expect(await hooks(inv.id, "invoice.late_payment")).toBe(1);

    // Its deposit turns up later and is folded into that same payment: nothing new to announce.
    clock.now = new Date(clock.now.getTime() + 6 * MIN);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, new Date(paidOutAt.getTime() - 2 * MIN)));
    for (let i = 0; i < 2; i++) {
      await poller.tick();
      clock.now = new Date(clock.now.getTime() + 6 * MIN);
    }
    expect(await t.db.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
    expect(await hooks(inv.id, "invoice.late_payment")).toBe(1);
  });

  it("keeps watching UNDERPAID and CANCELLED invoices, so money sent to them is recorded", async () => {
    const short = await invoice();
    const cancelled = await invoice();
    const { poller, clock } = makePoller(t);

    t.aurora.push(short.evm, "received", usdc(short.evm, 20, clock.now));
    t.aurora.push(short.evm, "success", payout(short.evm, 19.9, clock.now));
    await poller.tick();
    const cancel = await t.app.inject({ method: "POST", url: `/v1/invoices/${cancelled.id}/cancel`, headers: cancelled.auth });
    expect(cancel.statusCode).toBe(200);

    clock.now = new Date(new Date(short.expires_at).getTime() + 16 * MIN);
    await poller.tick();
    expect(await status(short.id)).toBe("UNDERPAID");
    expect(await status(cancelled.id)).toBe("CANCELLED");

    // The buyer tops up the short invoice, and someone pays the cancelled one, both after they closed. (A closed invoice
    // with no payment is polled every 5 minutes.)
    clock.now = new Date(clock.now.getTime() + 6 * MIN);
    t.aurora.push(short.evm, "received", usdc(short.evm, 29, clock.now));
    t.aurora.push(cancelled.evm, "received", usdc(cancelled.evm, 49, clock.now));
    await poller.tick();

    expect(await t.db.payment.count({ where: { invoiceId: short.id } })).toBe(2);
    expect(await t.db.payment.count({ where: { invoiceId: cancelled.id } })).toBe(1);
    expect(await hooks(cancelled.id, "invoice.late_payment")).toBe(1);
  });
});
