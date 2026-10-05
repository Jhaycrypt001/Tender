import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FxService, FX_CODES } from "../src/services/fx.service.js";
import { setupApp, teardown, type TestContext } from "./helpers.js";

const logger = { warn: vi.fn(), error: vi.fn() };

const sourceBody = (rates: Record<string, unknown>) => ({ result: "success", time_last_update_unix: 1_791_158_551, rates });
const respond = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await t.redis.del("tender:fx");
  logger.warn.mockClear();
});

const GOOD = { EUR: 0.88889, GBP: 0.755727, NGN: 1331.279356, JPY: 157.730309 };

describe("FxService", () => {
  it("fetches the rates once and serves them from the cache for an hour", async () => {
    const fetchMock = respond(sourceBody(GOOD));
    let now = new Date("2026-10-05T10:00:00Z");
    const fx = new FxService(t.redis, logger, fetchMock as unknown as typeof fetch, () => now);

    const first = await fx.get();
    expect(first?.rates).toEqual({ EUR: "0.88889", GBP: "0.755727", NGN: "1331.279356", JPY: "157.730309" });
    expect(first?.asOf).toBe(new Date(1_791_158_551 * 1000).toISOString());

    now = new Date("2026-10-05T10:30:00Z");
    await fx.get();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    now = new Date("2026-10-05T11:05:00Z");
    await fx.get();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("drops a missing or nonsensical rate instead of defaulting it", async () => {
    const fx = new FxService(t.redis, logger, respond(sourceBody({ ...GOOD, GBP: 0, NGN: "x", JPY: null })) as unknown as typeof fetch);
    const snap = await fx.get();
    expect(Object.keys(snap!.rates)).toEqual(["EUR"]);
  });

  it("serves the stale copy when the source is down, and nothing when there never was one", async () => {
    let now = new Date("2026-10-05T10:00:00Z");
    const ok = new FxService(t.redis, logger, respond(sourceBody(GOOD)) as unknown as typeof fetch, () => now);
    await ok.get();

    now = new Date("2026-10-06T10:00:00Z");
    const down = new FxService(t.redis, logger, respond({}, 500) as unknown as typeof fetch, () => now);
    expect((await down.get())?.rates.EUR).toBe("0.88889");
    expect(logger.warn).toHaveBeenCalled();

    await t.redis.del("tender:fx");
    expect(await down.get()).toBeNull();
  });

  it("offers exactly the currencies the dashboard lists", () => {
    expect(FX_CODES).toEqual(["EUR", "GBP", "NGN", "JPY", "CAD", "AUD", "CHF", "INR", "BRL", "ZAR", "AED", "SGD"]);
  });
});

describe("GET /public/fx", () => {
  it("is public, labelled USD-based, and cacheable", async () => {
    const withFx = await setupApp({}, { fx: new FxService(t.redis, logger, respond(sourceBody(GOOD)) as unknown as typeof fetch) });
    try {
      const res = await withFx.app.inject({ method: "GET", url: "/public/fx" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("public, max-age=300");
      expect(res.json()).toMatchObject({ base: "USD", rates: { EUR: "0.88889" } });
    } finally {
      await teardown(withFx);
    }
  });

  it("says 503 when there are no rates, rather than inventing one", async () => {
    const empty = await setupApp({}, { fx: new FxService(t.redis, logger, respond({}, 500) as unknown as typeof fetch) });
    try {
      const res = await empty.app.inject({ method: "GET", url: "/public/fx" });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe("not_ready");
    } finally {
      await teardown(empty);
    }
  });
});
