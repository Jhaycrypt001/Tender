import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as S from "../contract/schemas.js";
import { metricsAccess, registry } from "../src/lib/metrics.js";
import { registerWorkerGauges } from "../src/lib/worker-gauges.js";
import { ChainCatalogueReader, saveCatalogue } from "../src/services/chains.service.js";
import { merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
const clock = { now: new Date("2026-09-30T12:00:00Z") };
beforeAll(async () => {
  t = await setupApp();
  registerWorkerGauges({ db: t.db, catalogue: new ChainCatalogueReader(t.redis, 0), now: () => clock.now });
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.redis.flushdb();
});

const get = (url: string, headers: Record<string, string>) => t.app.inject({ method: "GET", url, headers });
const gauge = async (name: string) => {
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name);
  return (metric?.values[0]?.value ?? NaN) as number;
};

async function delivery(merchantId: string, extra: Record<string, unknown> = {}) {
  return t.db.webhookDelivery.create({
    data: { merchantId, invoiceId: "inv_test", event: "invoice.settled", payload: {}, ...extra },
  });
}

describe("GET /v1/merchant/webhook/deliveries", () => {
  it("tells delivered, retrying and failed apart, newest first", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    const base = Date.parse("2026-09-30T10:00:00Z");
    await delivery(m.id, { attempts: 1, deliveredAt: new Date(base), createdAt: new Date(base) });
    await delivery(m.id, { attempts: 2, nextRetryAt: new Date(base + 600_000), lastError: "HTTP 500", createdAt: new Date(base + 1000) });
    await delivery(m.id, { attempts: 8, lastError: "connect ECONNREFUSED", createdAt: new Date(base + 2000) });

    const res = await get("/v1/merchant/webhook/deliveries", auth);
    expect(res.statusCode).toBe(200);
    const { data } = S.WebhookDeliveryList.parse(res.json());
    expect(data.map((d) => d.status)).toEqual(["failed", "retrying", "delivered"]);
    expect(data[0]).toMatchObject({ attempts: 8, last_error: "connect ECONNREFUSED", next_retry_at: null, delivered_at: null });
    expect(data[1]).toMatchObject({ attempts: 2, last_error: "HTTP 500", delivered_at: null });
    expect(data[1]!.next_retry_at).toBeTruthy();
    expect(data[2]!.delivered_at).toBeTruthy();
  });

  it("filters by status, so a merchant can list exactly the events that never arrived", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    await delivery(m.id, { attempts: 1, deliveredAt: new Date() });
    await delivery(m.id, { attempts: 3, nextRetryAt: new Date() });
    const dead = await delivery(m.id, { attempts: 8, lastError: "gave up" });

    const failed = (await get("/v1/merchant/webhook/deliveries?status=failed", auth)).json().data;
    expect(failed.map((d: { id: string }) => d.id)).toEqual([dead.id]);
    expect((await get("/v1/merchant/webhook/deliveries?status=retrying", auth)).json().data).toHaveLength(1);
    expect((await get("/v1/merchant/webhook/deliveries?status=delivered", auth)).json().data).toHaveLength(1);
  });

  it("shows a merchant only their own deliveries", async () => {
    const a = await merchant(t.db, { name: "A" });
    const b = await merchant(t.db, { name: "B" });
    await delivery(a.merchant.id, { attempts: 8, lastError: "secret-a-detail" });
    const res = await get("/v1/merchant/webhook/deliveries", b.auth);
    expect(res.json().data).toEqual([]);
    expect(res.body).not.toContain("secret-a-detail");
  });

  it("never exposes the payload or the signing secret, and validates its query", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    await delivery(m.id, { payload: { data: { buyer_email: "private@buyer.test" } }, attempts: 1, deliveredAt: new Date() });
    const res = await get("/v1/merchant/webhook/deliveries", auth);
    expect(res.body).not.toMatch(/private@buyer|payload|whsec_/);
    expect((await get("/v1/merchant/webhook/deliveries?status=bogus", auth)).statusCode).toBe(400);
    expect((await get("/v1/merchant/webhook/deliveries?limit=0", auth)).statusCode).toBe(400);
    expect((await get("/v1/merchant/webhook/deliveries?limit=101", auth)).statusCode).toBe(400);
    expect((await get("/v1/merchant/webhook/deliveries", {})).statusCode).toBe(401);
  });

  it("honours the limit", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    for (let i = 0; i < 5; i++) await delivery(m.id, { attempts: 1, deliveredAt: new Date() });
    expect((await get("/v1/merchant/webhook/deliveries?limit=2", auth)).json().data).toHaveLength(2);
  });
});

describe("worker alert gauges", () => {
  it("poll lag is 0 with nothing open, and grows with the most overdue open address", async () => {
    expect(await gauge("tender_poll_lag_seconds")).toBe(0);

    const { auth } = await merchant(t.db);
    const created = await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: auth,
      payload: { amount_expected: "5.00", currency: "USD", reference: "lag-1" },
    });
    expect(created.statusCode).toBe(201);
    await t.db.invoiceAddress.updateMany({ data: { nextPollAt: new Date(clock.now.getTime() - 90_000) } });
    expect(await gauge("tender_poll_lag_seconds")).toBe(90);

    // Not yet due: no lag.
    await t.db.invoiceAddress.updateMany({ data: { nextPollAt: new Date(clock.now.getTime() + 60_000) } });
    expect(await gauge("tender_poll_lag_seconds")).toBe(0);
  });

  it("poll lag ignores a settled invoice's addresses: only open invoices can be stuck", async () => {
    const { auth } = await merchant(t.db);
    await t.app.inject({ method: "POST", url: "/v1/invoices", headers: auth, payload: { amount_expected: "5.00", currency: "USD", reference: "lag-2" } });
    await t.db.invoiceAddress.updateMany({ data: { nextPollAt: new Date(clock.now.getTime() - 600_000) } });
    await t.db.invoice.updateMany({ data: { status: "SETTLED" } });
    expect(await gauge("tender_poll_lag_seconds")).toBe(0);
  });

  it("counts only webhook deliveries that used every retry", async () => {
    const { merchant: m } = await merchant(t.db);
    expect(await gauge("tender_webhook_dead_letters")).toBe(0);
    await delivery(m.id, { attempts: 1, deliveredAt: new Date() });
    await delivery(m.id, { attempts: 3, nextRetryAt: new Date() });
    expect(await gauge("tender_webhook_dead_letters")).toBe(0);
    await delivery(m.id, { attempts: 8, lastError: "gave up" });
    await delivery(m.id, { attempts: 8, lastError: "gave up" });
    expect(await gauge("tender_webhook_dead_letters")).toBe(2);
  });

  it("reports the age of the cached minimums, and -1 when there are none", async () => {
    expect(await gauge("tender_chain_minimums_age_seconds")).toBe(-1);
    await saveCatalogue(t.redis, { measuredAt: new Date(clock.now.getTime() - 45 * 60_000).toISOString(), chains: [] });
    expect(await gauge("tender_chain_minimums_age_seconds")).toBe(45 * 60);
  });
});

describe("metricsAccess", () => {
  it("is open in development with no token, but disabled in production", () => {
    expect(metricsAccess({ NODE_ENV: "development" }, undefined)).toBe("ok");
    expect(metricsAccess({ NODE_ENV: "production" }, undefined)).toBe("disabled");
  });
  it("with a token, needs exactly that Bearer token", () => {
    const cfg = { NODE_ENV: "production", METRICS_TOKEN: "t".repeat(20) };
    expect(metricsAccess(cfg, `Bearer ${"t".repeat(20)}`)).toBe("ok");
    expect(metricsAccess(cfg, `Bearer ${"t".repeat(19)}x`)).toBe("denied");
    expect(metricsAccess(cfg, undefined)).toBe("denied");
  });
});
