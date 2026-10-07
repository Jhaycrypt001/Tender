import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;

beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  t.aurora.mintAddress.mockClear();
});

const usdc = (address: string, dollars: number, extra: { at?: Date; tx?: string } = {}) =>
  deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), ...extra });
const payout = (address: string, dollars: number, extra: { at?: Date; tx?: string } = {}) =>
  deposit(address, { asset: ASSETS.USDC_MONAD, amount: String(Math.round(dollars * 1e6)), ...extra });

async function standing(opts: { webhook?: boolean } = {}) {
  const m = await merchant(t.db);
  if (opts.webhook) await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const res = await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: m.auth });
  const body = res.json() as { address: string; chains: { chain: string }[] };
  return { ...m, res, body, address: body.address };
}

describe("standing deposit address", () => {
  it("is null until it is created, and a read never creates it", async () => {
    const m = await merchant(t.db);
    const res = await t.app.inject({ method: "GET", url: "/v1/deposit-address", headers: m.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    expect(await t.db.invoice.count({ where: { kind: "STANDING" } })).toBe(0);
    expect(t.aurora.mintAddress).not.toHaveBeenCalled();
  });

  it("is created once, then returned unchanged, and says where it settles", async () => {
    const first = await standing();
    expect(first.res.statusCode).toBe(201);
    expect(first.body).toMatchObject({ asset: "USDC", settles_to: expect.stringMatching(/^0x/) });
    expect(first.body.chains.map((c) => c.chain)).toEqual(expect.arrayContaining(["base", "ethereum", "arbitrum"]));
    // Only EVM chains share this address.
    expect(first.body.chains.map((c) => c.chain)).not.toContain("solana");

    const again = await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: first.auth });
    expect(again.statusCode).toBe(200);
    expect((again.json() as { address: string }).address).toBe(first.address);

    const read = await t.app.inject({ method: "GET", url: "/v1/deposit-address", headers: first.auth });
    expect((read.json() as { address: string }).address).toBe(first.address);

    // Minted once, for this merchant, as the EVM family, to Monad.
    expect(t.aurora.mintAddress).toHaveBeenCalledTimes(1);
    expect(t.aurora.mintAddress).toHaveBeenCalledWith(
      expect.objectContaining({ sender: `standing:${first.merchant.id}`, depositChain: "evm", destinationChain: "monad", destinationAsset: "USDC" }),
    );
  });

  it("will not mint for an unverified settlement address", async () => {
    const m = await merchant(t.db, { verified: false });
    const res = await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: m.auth });
    expect(res.statusCode).toBe(409);
    expect(t.aurora.mintAddress).not.toHaveBeenCalled();
  });

  it("is not a bill: it is hidden from invoice lists, public links and cancellation", async () => {
    const s = await standing();
    const inv = await t.db.invoice.findFirstOrThrow({ where: { merchantId: s.merchant.id, kind: "STANDING" } });

    const list = await t.app.inject({ method: "GET", url: "/v1/invoices", headers: s.auth });
    expect((list.json() as { data: unknown[] }).data).toHaveLength(0);

    expect((await t.app.inject({ method: "GET", url: `/public/invoices/${inv.token}` })).statusCode).toBe(404);
    expect((await t.app.inject({ method: "POST", url: `/v1/invoices/${inv.id}/cancel`, headers: s.auth })).statusCode).toBe(409);
    expect((await t.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PENDING");
  });

  it("turns each deposit into its own payment, settles it, and never judges or closes the address", async () => {
    const s = await standing({ webhook: true });
    const inv = await t.db.invoice.findFirstOrThrow({ where: { merchantId: s.merchant.id, kind: "STANDING" } });
    const { poller, clock } = makePoller(t);

    t.aurora.push(s.address, "received", usdc(s.address, 0.5, { tx: "tx_a" }));
    await poller.tick();
    expect(await t.db.payment.count({ where: { invoiceId: inv.id } })).toBe(1);

    t.aurora.push(s.address, "success", payout(s.address, 0.499, { tx: "out_a" }));
    clock.now = new Date(clock.now.getTime() + 61_000);
    await poller.tick();

    // A second, unrelated deposit later: its own payment, not an "overpayment".
    t.aurora.push(s.address, "received", usdc(s.address, 12, { tx: "tx_b" }));
    t.aurora.push(s.address, "success", payout(s.address, 11.9, { tx: "out_b" }));
    clock.now = new Date(clock.now.getTime() + 61_000);
    await poller.tick();

    const payments = await t.db.payment.findMany({ where: { invoiceId: inv.id }, orderBy: { firstSeenAt: "asc" } });
    expect(payments.map((p) => p.status)).toEqual(["SETTLED", "SETTLED"]);
    expect(payments.map((p) => p.amountSettled?.toString())).toEqual(["0.499", "11.9"]);

    // The address itself stays open: no status change, no history, no invoice webhooks.
    expect((await t.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PENDING");
    expect(await t.db.invoiceEvent.count({ where: { invoiceId: inv.id } })).toBe(1);
    const hooks = await t.db.webhookDelivery.findMany({ where: { invoiceId: inv.id }, orderBy: { createdAt: "asc" } });
    expect(hooks.map((h) => h.event)).toEqual(["deposit.settled", "deposit.settled"]);
    expect(hooks[0]!.payload).toMatchObject({
      event: "deposit.settled",
      data: { tx_hash: "tx_a", from_chain: "base", amount_in: "0.50", amount_settled: "0.499" },
    });

    // And it reaches the merchant's numbers and lists as a deposit.
    const balance = await t.app.inject({ method: "GET", url: "/v1/merchant/balance", headers: s.auth });
    expect((balance.json() as { settled: { amount: string }[] }).settled[0]!.amount).toBe("12.399");
    const list = await t.app.inject({ method: "GET", url: "/v1/payments", headers: s.auth });
    expect((list.json() as { data: { source: string }[] }).data.map((p) => p.source)).toEqual(["deposit", "deposit"]);
  });

  it("is idempotent, and polled at the slow rate", async () => {
    const s = await standing();
    const { poller, clock } = makePoller(t);
    t.aurora.push(s.address, "received", usdc(s.address, 1, { tx: "tx_1" }));
    t.aurora.push(s.address, "success", payout(s.address, 0.99, { tx: "out_1" }));

    await poller.tick();
    // Not due again after the OPEN-invoice interval: this address is never waiting on one buyer.
    clock.now = new Date(clock.now.getTime() + 10_000);
    expect(await poller.tick()).toMatchObject({ polled: 0 });

    clock.now = new Date(clock.now.getTime() + 61_000);
    await poller.tick();
    expect(await t.db.payment.count()).toBe(1);
    expect(await t.db.webhookDelivery.count()).toBe(0);
  });

  it("only asks for payout lists while a deposit is waiting for its payout", async () => {
    const s = await standing();
    const { poller, clock } = makePoller(t);
    const calls = () => t.aurora.deposits.mock.calls.filter(([a]) => a === s.address).map(([, type]) => type);

    t.aurora.deposits.mockClear();
    await poller.tick();
    // Idle: one call, no payout lists.
    expect(calls()).toEqual(["received"]);

    // A new deposit appears: payout lists are read on the same poll.
    t.aurora.deposits.mockClear();
    t.aurora.push(s.address, "received", usdc(s.address, 2, { tx: "tx_w" }));
    clock.now = new Date(clock.now.getTime() + 61_000);
    await poller.tick();
    expect(calls().sort()).toEqual(["failed", "received", "success"]);

    // Still waiting for its payout: keep reading them; once paid out, stop.
    t.aurora.push(s.address, "success", payout(s.address, 1.99, { tx: "out_w" }));
    clock.now = new Date(clock.now.getTime() + 61_000);
    await poller.tick();
    expect((await t.db.payment.findFirstOrThrow()).status).toBe("SETTLED");

    t.aurora.deposits.mockClear();
    clock.now = new Date(clock.now.getTime() + 61_000);
    await poller.tick();
    expect(calls()).toEqual(["received"]);
  });

  it("sees every deposit on an address whose list spans several pages", async () => {
    const s = await standing();
    const { poller } = makePoller(t);
    for (let i = 0; i < 230; i++) t.aurora.push(s.address, "received", usdc(s.address, 1, { tx: `tx_${i}` }));
    await poller.tick();
    expect(await t.db.payment.count()).toBe(230);
  });

  it("records a failed payout as a payment needing recovery, without closing the address", async () => {
    const s = await standing({ webhook: true });
    const { poller } = makePoller(t);
    t.aurora.push(s.address, "received", usdc(s.address, 5, { tx: "tx_f" }));
    t.aurora.push(s.address, "failed", payout(s.address, 5, { tx: "out_f" }));
    await poller.tick();

    const p = await t.db.payment.findFirstOrThrow({ include: { recovery: true } });
    expect(p.status).toBe("FAILED");
    expect(p.recovery).not.toBeNull();
    const hooks = await t.db.webhookDelivery.findMany();
    expect(hooks.map((h) => h.event)).toEqual(["deposit.failed"]);
    expect((await t.db.invoice.findFirstOrThrow({ where: { kind: "STANDING" } })).status).toBe("PENDING");
  });

  it("keeps watching the old address after the merchant changes their settlement wallet", async () => {
    const s = await standing();
    const other = "0x1111111111111111111111111111111111111111";
    await t.db.merchant.update({ where: { id: s.merchant.id }, data: { settlementAddress: other } });

    const res = await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: s.auth });
    expect(res.statusCode).toBe(201);
    const next = (res.json() as { address: string }).address;
    expect(next).not.toBe(s.address);
    expect(await t.db.invoice.count({ where: { kind: "STANDING", merchantId: s.merchant.id } })).toBe(2);

    // Money still sent to the old address is still tracked.
    const { poller } = makePoller(t);
    t.aurora.push(s.address, "received", usdc(s.address, 3, { tx: "tx_old" }));
    await poller.tick();
    expect(await t.db.payment.count()).toBe(1);
  });
});
