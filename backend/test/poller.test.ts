import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;

beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

const MIN = 60_000;

/** A $49 invoice accepting Base and Solana, with a webhook URL so the outbox is exercised. */
async function invoice(amount = "49.00") {
  const m = await merchant(t.db);
  await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: amount, currency: "USD", reference: `order_${Math.random()}`, chains: ["base", "solana"] },
  });
  const inv = res.json() as { id: string; token: string; expires_at: string; addresses: { chain: string; address: string }[] };
  const addr = (chain: string) => inv.addresses.find((a) => a.chain === chain)!.address;
  return { ...inv, evm: addr("base"), sol: addr("solana") };
}

const status = async (id: string) => (await t.db.invoice.findUniqueOrThrow({ where: { id } })).status;
const usdc = (address: string, dollars: number, extra: { at?: Date; tx?: string } = {}) =>
  deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), ...extra });
const payout = (address: string, dollars: number, extra: { at?: Date; tx?: string } = {}) =>
  deposit(address, { asset: ASSETS.USDC_MONAD, amount: String(Math.round(dollars * 1e6)), ...extra });

describe("poller", () => {
  it("does nothing when nothing has arrived, and schedules the next poll", async () => {
    const inv = await invoice();
    const { poller } = makePoller(t);
    expect(await poller.tick()).toMatchObject({ polled: 2, transitions: 0 });
    expect(await status(inv.id)).toBe("PENDING");
    // Not due again until the interval passes.
    expect(await poller.tick()).toMatchObject({ polled: 0 });
  });

  it("walks PENDING → DETECTED → SETTLED, with events, webhooks and live updates", async () => {
    const inv = await invoice();
    const { poller, publish, clock } = makePoller(t);

    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    await poller.tick();
    expect(await status(inv.id)).toBe("DETECTED");

    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(payment).toMatchObject({ status: "DETECTED", fromChain: "base" });
    expect(payment.amountIn.toString()).toBe("49");
    expect(payment.amountInUsd?.toString()).toBe("49");

    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8));
    clock.now = new Date(clock.now.getTime() + 10_000);
    await poller.tick();
    expect(await status(inv.id)).toBe("SETTLED");

    const settled = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(settled.status).toBe("SETTLED");
    expect(settled.amountSettled?.toString()).toBe("48.8");

    const events = await t.db.invoiceEvent.findMany({ where: { invoiceId: inv.id }, orderBy: { at: "asc" } });
    expect(events.map((e) => e.status)).toEqual(["PENDING", "DETECTED", "SETTLED"]);

    const hooks = await t.db.webhookDelivery.findMany({ where: { invoiceId: inv.id }, orderBy: { createdAt: "asc" } });
    expect(hooks.map((h) => h.event)).toEqual(["invoice.detected", "invoice.settled"]);
    // The payload shape published at /docs.
    expect(hooks[1]!.payload).toMatchObject({
      id: expect.stringMatching(/^evt_/),
      event: "invoice.settled",
      data: { invoice_id: inv.id, status: "SETTLED", amount_expected: "49.00", amount_settled: "48.80", from_chain: "base" },
    });

    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.at(-1)).toEqual([`invoice-events:${inv.token}`, expect.stringContaining('"status":"SETTLED"')]);
  });

  it("is idempotent: the same data polled again changes nothing", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8));

    for (let i = 0; i < 3; i++) {
      await poller.tick();
      clock.now = new Date(clock.now.getTime() + 10_000);
    }
    expect(await t.db.payment.count()).toBe(1);
    expect(await t.db.invoiceEvent.count({ where: { invoiceId: inv.id } })).toBe(2); // PENDING, SETTLED
    expect(await t.db.webhookDelivery.count()).toBe(1);
  });

  it("is safe with two pollers running at once", async () => {
    const inv = await invoice();
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8));

    const a = makePoller(t);
    const b = makePoller(t);
    await Promise.all([a.poller.tick(), b.poller.tick(), a.poller.tick(), b.poller.tick()]);

    expect(await t.db.payment.count()).toBe(1);
    expect(await status(inv.id)).toBe("SETTLED");
    expect(await t.db.webhookDelivery.count({ where: { event: "invoice.settled" } })).toBe(1);
  });

  it("values a non-stablecoin deposit at its USD price", async () => {
    const inv = await invoice();
    const { poller } = makePoller(t);
    // 0.329 SOL at $150 = $49.35: within 1% of $49.
    t.aurora.push(inv.sol, "received", deposit(inv.sol, { asset: ASSETS.SOL, amount: "329000000", fromChain: "sol" }));
    t.aurora.push(inv.sol, "success", payout(inv.sol, 49.1));
    await poller.tick();

    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(payment).toMatchObject({ fromChain: "solana" });
    expect(payment.amountInUsd?.toFixed(2)).toBe("49.35");
    expect(await status(inv.id)).toBe("SETTLED");
  });

  it("marks a deposit that fails onward as NEEDS_RECOVERY, with a recovery task", async () => {
    const inv = await invoice();
    const { poller } = makePoller(t);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    t.aurora.push(inv.evm, "failed", payout(inv.evm, 48.8));
    await poller.tick();

    expect(await status(inv.id)).toBe("NEEDS_RECOVERY");
    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id }, include: { recovery: true } });
    expect(payment.status).toBe("FAILED");
    expect(payment.recovery?.state).toBe("OPEN");
    expect(await t.db.webhookDelivery.findFirst({ where: { event: "invoice.needs_recovery" } })).not.toBeNull();
  });

  it("reports a second payment after settlement as an overpayment", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8));
    await poller.tick();
    expect(await status(inv.id)).toBe("SETTLED");

    t.aurora.push(inv.sol, "received", deposit(inv.sol, { asset: ASSETS.SOL, amount: "100000000", fromChain: "sol" }));
    clock.now = new Date(clock.now.getTime() + 10_000);
    await poller.tick();
    expect(await status(inv.id)).toBe("OVERPAID");
    expect(await t.db.payment.count({ where: { invoiceId: inv.id } })).toBe(2);
  });

  it("holds a short payment at DETECTED, then UNDERPAID once the window closes", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 20));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 19.9));
    await poller.tick();
    expect(await status(inv.id)).toBe("DETECTED");

    clock.now = new Date(new Date(inv.expires_at).getTime() + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("UNDERPAID");
  });

  it("expires an unpaid invoice only after a successful poll past the window", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    clock.now = new Date(new Date(inv.expires_at).getTime() + 16 * MIN);

    // Aurora is down: the invoice must NOT expire — a payment may be sitting there.
    t.aurora.fail(inv.evm);
    await poller.tick();
    expect(await status(inv.id)).toBe("PENDING");

    t.aurora.fail(inv.evm, false);
    clock.now = new Date(clock.now.getTime() + 10 * MIN); // past the backoff
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");
    expect(await t.db.webhookDelivery.findFirst({ where: { event: "invoice.expired" } })).not.toBeNull();
  });

  it("records late money without reopening an expired invoice", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    clock.now = new Date(new Date(inv.expires_at).getTime() + 16 * MIN);
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");

    clock.now = new Date(clock.now.getTime() + 10 * MIN);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, { at: clock.now }));
    await poller.tick();
    expect(await status(inv.id)).toBe("EXPIRED");
    expect(await t.db.payment.count({ where: { invoiceId: inv.id } })).toBe(1);
  });

  it("counts a deposit that reached Aurora within the grace period", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const deadline = new Date(inv.expires_at).getTime();
    clock.now = new Date(deadline + 20 * MIN);
    // Sent before the deadline, reached Aurora 5 minutes after it.
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, { at: new Date(deadline + 5 * MIN) }));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8, { at: new Date(deadline + 6 * MIN) }));
    await poller.tick();
    expect(await status(inv.id)).toBe("SETTLED");
  });

  it("backs off a failing address without blocking the others", async () => {
    const inv = await invoice();
    const { poller } = makePoller(t);
    t.aurora.fail(inv.sol);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    await poller.tick();

    expect(await status(inv.id)).toBe("DETECTED");
    const sol = await t.db.invoiceAddress.findFirstOrThrow({ where: { address: inv.sol } });
    expect(sol.pollFailures).toBe(1);
    expect(sol.nextPollAt.getTime()).toBeGreaterThan(Date.now() + 5_000);
  });

  it("records a deposit it cannot price, but never settles on a guess", async () => {
    const inv = await invoice();
    const { poller } = makePoller(t);
    t.aurora.push(inv.evm, "received", deposit(inv.evm, { asset: ASSETS.UNPRICED, amount: "1000000000000000000" }));
    t.aurora.push(inv.evm, "success", payout(inv.evm, 48.8));
    await poller.tick();

    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(payment.amountInUsd).toBeNull();
    expect(await status(inv.id)).toBe("DETECTED");
  });
});
