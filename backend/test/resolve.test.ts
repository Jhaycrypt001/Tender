import { Writable } from "node:stream";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PriceBook } from "../src/aurora/prices.js";
import { loggerOptions } from "../src/lib/logger.js";
import { Poller } from "../src/workers/poller.js";
import { ASSETS, deposit, merchant, PLATFORM_KEY, POLLER_CONFIG, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.redis.flushdb();
});

type Line = Record<string, unknown> & { msg: string; level: number };
function loggedPoller(clock: { now: Date }) {
  const lines: Line[] = [];
  const stream = new Writable({
    write(chunk, _e, cb) {
      for (const raw of chunk.toString().split("\n")) if (raw.trim()) lines.push(JSON.parse(raw) as Line);
      cb();
    },
  });
  const poller = new Poller({
    db: t.db,
    aurora: t.aurora,
    prices: new PriceBook(t.aurora),
    redis: { publish: vi.fn(async () => 1) } as never,
    logger: pino(loggerOptions("debug", false), stream),
    config: POLLER_CONFIG,
    now: () => clock.now,
  });
  const advance = async (minutes: number) => {
    clock.now = new Date(clock.now.getTime() + minutes * 60_000);
    await poller.tick();
  };
  return { poller, lines, advance, find: (msg: string) => lines.filter((l) => l.msg === msg) };
}

const usdc = (address: string, dollars: number, tx?: string) => deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), tx });
const resolve = (id: string, body: object, key: string | null = PLATFORM_KEY) =>
  t.app.inject({ method: "POST", url: `/internal/payments/${id}/resolve`, headers: key ? { authorization: `Bearer ${key}` } : {}, payload: body });
const REFUND = { outcome: "refunded", tx_hash: "0xrefund0000000000000000", note: "Aurora support refunded the sender" };

/** A merchant's standing address with a deposit Aurora took and never paid out: ILERI's case. */
async function stuckStanding(clock: { now: Date }) {
  const m = await merchant(t.db);
  await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const address = ((await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: m.auth })).json() as { address: string }).address;
  const p = loggedPoller(clock);
  t.aurora.push(address, "received", usdc(address, 19.96, "0xstuck_standing"));
  await p.advance(1); // the address was created just after the clock's "now": it is due a moment later
  const payment = await t.db.payment.findFirstOrThrow({ where: { auroraTxHash: "0xstuck_standing" } });
  expect(payment.status).toBe("DETECTED");
  return { m, address, payment, ...p };
}

/** A $49 invoice whose deposit Aurora took and never paid out. */
async function stuckInvoice(clock: { now: Date }) {
  const m = await merchant(t.db);
  await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const inv = (
    await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload: { amount_expected: "49.00", currency: "USD", reference: `o_${Math.random()}`, chains: ["base"] } })
  ).json() as { id: string; addresses: { address: string }[] };
  const address = inv.addresses[0]!.address;
  const p = loggedPoller(clock);
  t.aurora.push(address, "received", usdc(address, 49, "0xstuck_invoice"));
  await p.advance(1);
  const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
  return { m, inv, address, payment, ...p };
}

describe("POST /internal/payments/:id/resolve", () => {
  it("is refused without the platform key, and for a payment that does not exist", async () => {
    const { payment } = await stuckStanding({ now: new Date() });
    expect((await resolve(payment.id, REFUND, null)).statusCode).toBe(401);
    expect((await resolve(payment.id, REFUND, "tp_wrong")).statusCode).toBe(401);
    expect((await resolve("pay_nope", REFUND)).statusCode).toBe(404);
    expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("DETECTED");
  });

  it("needs proof and a reason, and an amount when settled", async () => {
    const { payment } = await stuckStanding({ now: new Date() });
    for (const body of [
      { ...REFUND, tx_hash: "" },
      { ...REFUND, note: "" },
      { outcome: "settled", tx_hash: "0xdelivered00000000", note: "Delivered by Aurora support" },
      { ...REFUND, outcome: "lost" },
    ]) {
      expect((await resolve(payment.id, body)).statusCode, JSON.stringify(body)).toBe(400);
    }
  });

  it("refunds a stuck standing deposit: status, audit trail, no webhook, once only, and the warning stops", async () => {
    const clock = { now: new Date() };
    const { m, payment, advance, find } = await stuckStanding(clock);
    await advance(11);
    expect(find("deposit received by Aurora but not paid out yet")).toHaveLength(1);

    const res = await resolve(payment.id, REFUND);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: payment.id, status: "REFUNDED" });

    const after = await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after).toMatchObject({ status: "REFUNDED", outcomeTxHash: `manual:${REFUND.tx_hash}`, amountSettled: null });
    expect((after.raw as { manual: object }).manual).toMatchObject({ outcome: "refunded", tx_hash: REFUND.tx_hash, note: REFUND.note });
    // There is no published webhook for a refund.
    expect(await t.db.webhookDelivery.count({ where: { merchantId: m.merchant.id } })).toBe(0);

    const detail = (await t.app.inject({ method: "GET", url: `/v1/payments/${payment.id}`, headers: m.auth })).json();
    expect(detail.history.at(-1)).toMatchObject({ status: "REFUNDED", note: expect.stringContaining("Resolved by Tender support") });

    expect((await resolve(payment.id, REFUND)).statusCode).toBe(409);
    await advance(20);
    await advance(20);
    expect(find("deposit received by Aurora but not paid out yet")).toHaveLength(1);
  });

  it("settles a stuck standing deposit and sends the deposit webhook the poller would", async () => {
    const { m, payment } = await stuckStanding({ now: new Date() });
    const res = await resolve(payment.id, { outcome: "settled", tx_hash: "0xdelivered00000000", amount_settled: "19.90", note: "Aurora delivered USDC by hand" });
    expect(res.json()).toMatchObject({ status: "SETTLED" });
    const after = await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.amountSettled?.toString()).toBe("19.9");
    expect(after.settledAt).not.toBeNull();
    const hooks = await t.db.webhookDelivery.findMany({ where: { merchantId: m.merchant.id } });
    expect(hooks.map((h) => h.event)).toEqual(["deposit.settled"]);
  });

  it("re-judges a normal invoice and sends its webhook", async () => {
    const { inv, payment } = await stuckInvoice({ now: new Date() });
    expect((await t.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("DETECTED");
    await resolve(payment.id, { outcome: "settled", tx_hash: "0xdelivered11111111", amount_settled: "48.80", note: "Aurora delivered by hand" });
    expect((await t.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("SETTLED");
    const hooks = await t.db.webhookDelivery.findMany({ where: { invoiceId: inv.id }, orderBy: { createdAt: "asc" } });
    expect(hooks.map((h) => h.event)).toEqual(["invoice.detected", "invoice.settled"]);
  });

  it("closes the recovery task of a failed payout that support resolved", async () => {
    const clock = { now: new Date() };
    const { payment, address, poller } = await stuckInvoice(clock);
    t.aurora.push(address, "failed", deposit(address, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
    clock.now = new Date(clock.now.getTime() + 10_000);
    await poller.tick();
    expect(await t.db.recoveryTask.findUniqueOrThrow({ where: { paymentId: payment.id } })).toMatchObject({ state: "OPEN" });

    expect((await resolve(payment.id, REFUND)).statusCode).toBe(200);
    const task = await t.db.recoveryTask.findUniqueOrThrow({ where: { paymentId: payment.id } });
    expect(task.state).toBe("RESOLVED");
    expect(task.notes).toContain("Resolved by hand: refunded");
  });
});

describe("Aurora calls for a long wait", () => {
  const payoutChecks = (address: string) =>
    t.aurora.deposits.mock.calls.filter(([a, type]) => a === address && (type === "success" || type === "failed")).length / 2;

  it("checks a fresh wait on every poll, and a day-old one only every 30 minutes", async () => {
    const clock = { now: new Date() };
    const { address, advance } = await stuckStanding(clock);

    t.aurora.deposits.mockClear();
    for (let i = 0; i < 10; i++) await advance(1); // standing addresses are polled every minute
    expect(payoutChecks(address)).toBe(10); // under a day: every poll

    await advance(25 * 60); // a day on
    t.aurora.deposits.mockClear();
    for (let i = 0; i < 60; i++) await advance(1);
    expect(payoutChecks(address)).toBe(2); // an hour of polls, two payout checks
    // New money is still looked for on every poll.
    expect(t.aurora.deposits.mock.calls.filter(([a, type]) => a === address && type === "received").length).toBeGreaterThanOrEqual(60);
   }, 60_000);

  it("still records a payout that lands after a day, within 30 minutes", async () => {
    const clock = { now: new Date() };
    const { address, payment, advance } = await stuckStanding(clock);
    await advance(25 * 60);
    t.aurora.push(address, "success", deposit(address, { asset: ASSETS.USDC_MONAD, amount: "19900000" }));
    for (let i = 0; i < 31; i++) await advance(1);
    expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SETTLED");
  }, 60_000);
});
