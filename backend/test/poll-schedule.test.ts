import type { Redis } from "ioredis";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PriceBook } from "../src/aurora/prices.js";
import { createLogger } from "../src/lib/logger.js";
import { Poller } from "../src/workers/poller.js";
import { makePoller, merchant, POLLER_CONFIG, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** When each address is polled, and when an unpaid invoice may be closed. */

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

const MIN = 60_000;

async function invoice() {
  const m = await merchant(t.db);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: "49.00", currency: "USD", reference: `order_${Math.random()}`, chains: ["base"] },
  });
  const inv = res.json() as { id: string; expires_at: string; addresses: { chain: string; address: string }[] };
  return { id: inv.id, expires_at: inv.expires_at, evm: inv.addresses[0]!.address };
}
const status = async (id: string) => (await t.db.invoice.findUniqueOrThrow({ where: { id } })).status;
const addr = (invoiceId: string) => t.db.invoiceAddress.findFirstOrThrow({ where: { invoiceId } });

describe("closing an unpaid invoice", () => {
  it("needs a successful poll AFTER the window closed, not just an address that is not due for a while", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const closesAt = new Date(inv.expires_at).getTime() + 15 * MIN;

    // Polled fine, but before the window closed.
    clock.now = new Date(closesAt - 5 * MIN);
    await poller.tick();
    expect((await addr(inv.id)).lastPolledOkAt?.getTime()).toBe(clock.now.getTime());

    // Later the window closes and the address is not polled again (backed off, or behind in the queue): a payment
    // could be sitting at Aurora, so the invoice must NOT be called unpaid yet.
    clock.now = new Date(closesAt + MIN);
    await t.db.invoiceAddress.updateMany({ where: { invoiceId: inv.id }, data: { nextPollAt: new Date(clock.now.getTime() + 60 * MIN) } });
    await poller.tick();
    expect(await status(inv.id)).toBe("PENDING");
  });
});

describe("how often an address is polled", () => {
  it("polls a closed invoice nobody paid every 5 minutes, not every minute", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    clock.now = new Date(new Date(inv.expires_at).getTime() + 16 * MIN);
    await poller.tick(); // closes it
    expect(await status(inv.id)).toBe("EXPIRED");

    clock.now = new Date(clock.now.getTime() + 10_000);
    await poller.tick(); // polled as EXPIRED: schedules its next poll
    expect((await addr(inv.id)).nextPollAt.getTime() - clock.now.getTime()).toBe(5 * MIN);
  });

  it("serves open invoices before closed ones when there is not room for everything", async () => {
    const open = await invoice();
    const closed = await invoice();
    await t.db.invoice.update({ where: { id: closed.id }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 2 * MIN) } });
    const now = new Date();
    // The closed one has been waiting longer, so a plain oldest-first queue would pick it.
    await t.db.invoiceAddress.update({ where: { id: (await addr(closed.id)).id }, data: { nextPollAt: new Date(now.getTime() - 50 * MIN) } });
    await t.db.invoiceAddress.update({ where: { id: (await addr(open.id)).id }, data: { nextPollAt: new Date(now.getTime() - 1 * MIN) } });

    const poller = new Poller({
      db: t.db,
      aurora: t.aurora,
      prices: new PriceBook(t.aurora),
      redis: { publish: vi.fn(async () => 1) } as unknown as Pick<Redis, "publish">,
      logger: createLogger("fatal", false),
      config: { ...POLLER_CONFIG, batchSize: 1 },
      now: () => now,
    });
    await poller.tick();

    expect((await addr(open.id)).lastPolledOkAt).not.toBeNull();
    expect((await addr(closed.id)).lastPolledOkAt).toBeNull();
  });
});

describe("expiry passes", () => {
  it("does not let invoices that cannot close yet hold up the ones behind them", async () => {
    const stuck = await invoice(); // the oldest: its address has not been polled successfully
    const ready = await invoice();
    await t.db.invoiceAddress.updateMany({ where: { invoiceId: stuck.id }, data: { pollFailures: 5, nextPollAt: new Date(Date.now() + 24 * 60 * MIN) } });
    const clock = { now: new Date(new Date(ready.expires_at).getTime() + 20 * MIN) };
    const poller = new Poller({
      db: t.db,
      aurora: t.aurora,
      prices: new PriceBook(t.aurora),
      redis: { publish: vi.fn(async () => 1) } as unknown as Redis,
      logger: createLogger("fatal", false),
      config: { ...POLLER_CONFIG, batchSize: 1 },
      now: () => clock.now,
    });
    await poller.tick(); // polls the ready invoice's address
    await poller.tick(); // the expiry pass must reach past the stuck invoice in front of it
    expect(await status(stuck.id)).toBe("PENDING");
    expect(await status(ready.id)).toBe("EXPIRED");
  });
});
