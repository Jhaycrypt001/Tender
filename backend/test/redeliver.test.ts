import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** A webhook the merchant's server never received can be sent again by that merchant, and only by them. */

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

async function setup() {
  const m = await merchant(t.db);
  await t.db.merchant.update({ where: { id: m.merchant.id }, data: { webhookUrl: "https://merchant.test/hooks" } });
  const make = (data: { nextRetryAt: Date | null; deliveredAt: Date | null; attempts: number }) =>
    t.db.webhookDelivery.create({ data: { merchantId: m.merchant.id, invoiceId: "inv_x", event: "invoice.expired", payload: { id: "evt_1" }, lastError: "HTTP 500", ...data } });
  return { m, make };
}
const redeliver = (auth: Record<string, string>, id: string) => t.app.inject({ method: "POST", url: `/v1/merchant/webhook/deliveries/${id}/redeliver`, headers: auth });

describe("POST /v1/merchant/webhook/deliveries/:id/redeliver", () => {
  it("queues a given-up delivery again with a fresh set of attempts, and refuses one that already arrived", async () => {
    const { m, make } = await setup();
    const failed = await make({ nextRetryAt: null, deliveredAt: null, attempts: 7 });
    const delivered = await make({ nextRetryAt: null, deliveredAt: new Date(), attempts: 1 });

    const res = await redeliver(m.auth, failed.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: failed.id, status: "retrying", attempts: 0 });
    const row = await t.db.webhookDelivery.findUniqueOrThrow({ where: { id: failed.id } });
    expect(row.nextRetryAt).not.toBeNull();
    expect(row.lastError).toBeNull();

    expect((await redeliver(m.auth, delivered.id)).statusCode).toBe(409);
  });

  it("will not touch another merchant's delivery", async () => {
    const { make } = await setup();
    const other = await merchant(t.db);
    const mine = await make({ nextRetryAt: null, deliveredAt: null, attempts: 7 });

    expect((await redeliver(other.auth, mine.id)).statusCode).toBe(404);
    expect((await t.db.webhookDelivery.findUniqueOrThrow({ where: { id: mine.id } })).nextRetryAt).toBeNull();
  });
});
