import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Agent } from "undici";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/lib/logger.js";
import { WebhookWorker } from "../src/workers/webhook.worker.js";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/**
 * BACKEND.md §12: "Kill the API mid-poll, restart → no duplicate Payment rows,
 * state intact."
 *
 * A process kill is simulated at the three moments that matter, against the
 * real test database:
 *   1. inside the poller's transaction, before commit;
 *   2. after the commit, before the live update is published;
 *   3. a webhook worker dying while it holds a delivery.
 * In each case a fresh worker ("the restart") must finish the job exactly once.
 */

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(() => resetDb(t.db));

class Killed extends Error {}

async function paidInvoice() {
  const m = await merchant(t.db);
  await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const inv = (
    await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: m.auth,
      payload: { amount_expected: "49.00", currency: "USD", reference: `crash_${Math.random()}`, chains: ["base"] },
    })
  ).json() as { id: string; addresses: { address: string }[] };
  const address = inv.addresses[0]!.address;
  t.aurora.push(address, "received", deposit(address, { asset: ASSETS.USDC_BASE, amount: "49000000" }));
  t.aurora.push(address, "success", deposit(address, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
  return { m, inv, address };
}

const counts = async (invoiceId: string) => ({
  payments: await t.db.payment.count({ where: { invoiceId } }),
  events: await t.db.invoiceEvent.count({ where: { invoiceId } }),
  webhooks: await t.db.webhookDelivery.count({ where: { invoiceId } }),
  status: (await t.db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
});

describe("crash and restart", () => {
  it("1. killed mid-transaction: nothing half-written, and the restart completes it", async () => {
    const { inv } = await paidInvoice();
    const doomed = makePoller(t);
    // Die at the last step inside the transaction — after payments were inserted and outcomes recorded.
    (doomed.poller as unknown as { settle: () => never }).settle = () => {
      throw new Killed("process killed");
    };
    await doomed.poller.tick(); // the per-address guard logs it; the transaction rolls back

    // Rolled back: no payment, no event beyond creation, no webhook — and the address is still due.
    expect(await counts(inv.id)).toEqual({ payments: 0, events: 1, webhooks: 0, status: "PENDING" });

    await makePoller(t).poller.tick(); // the restart
    expect(await counts(inv.id)).toEqual({ payments: 1, events: 2, webhooks: 1, status: "SETTLED" });
  });

  it("2. killed after commit, before the live update: state kept, restart duplicates nothing", async () => {
    const { inv } = await paidInvoice();
    const doomed = makePoller(t);
    doomed.publish.mockRejectedValue(new Killed("process killed before publishing"));
    await doomed.poller.tick();
    expect(await counts(inv.id)).toEqual({ payments: 1, events: 2, webhooks: 1, status: "SETTLED" });

    // The restart re-polls the same address (a closed invoice stays watched) and must change nothing.
    const restart = makePoller(t, { now: new Date(Date.now() + 60_000) });
    await restart.poller.tick();
    expect(await counts(inv.id)).toEqual({ payments: 1, events: 2, webhooks: 1, status: "SETTLED" });
    expect(restart.publish).not.toHaveBeenCalled();
  });

  describe("3. webhook worker killed while holding a delivery", () => {
    let receiver: Server;
    let url: string;
    let hits = 0;
    const loopback = new Agent();

    beforeAll(async () => {
      receiver = createServer((_req, res) => {
        hits++;
        res.end("ok");
      });
      await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
    });
    afterAll(async () => {
      await new Promise((r) => receiver.close(r));
      await loopback.close();
    });

    it("the lease expires and another worker delivers it — once", async () => {
      hits = 0;
      const { m, inv } = await paidInvoice();
      await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: url } });
      await makePoller(t).poller.tick();
      expect(await t.db.webhookDelivery.count({ where: { invoiceId: inv.id } })).toBe(1);

      // A worker claims the row (lease of 60s) and dies before sending.
      const clock = { now: new Date() };
      const claimed = await t.db.$executeRaw`
        UPDATE "WebhookDelivery" SET "nextRetryAt" = ${new Date(clock.now.getTime() + 60_000)} WHERE "invoiceId" = ${inv.id}`;
      expect(claimed).toBe(1);

      const worker = new WebhookWorker({ db: t.db, logger: createLogger("fatal", false), dispatcher: loopback, now: () => clock.now });
      // While the lease holds, nobody else sends it.
      expect(await worker.tick()).toEqual({ delivered: 0, failed: 0 });
      expect(hits).toBe(0);

      // After the lease, the restarted worker delivers it exactly once.
      clock.now = new Date(clock.now.getTime() + 61_000);
      expect(await worker.tick()).toEqual({ delivered: 1, failed: 0 });
      expect(await worker.tick()).toEqual({ delivered: 0, failed: 0 });
      expect(hits).toBe(1);
    });
  });
});
