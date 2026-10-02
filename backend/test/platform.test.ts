import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { PLATFORM_KEY, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.redis.flushdb();
});

const platform = { authorization: `Bearer ${PLATFORM_KEY}` };
const resolve = (body: object, headers: Record<string, string> = platform) =>
  t.app.inject({ method: "POST", url: "/internal/merchants/resolve", headers, payload: body });
const as = (id: string) => ({ ...platform, "x-tender-merchant": id });

describe("POST /internal/merchants/resolve", () => {
  it("creates a merchant on first sign-in (201) and returns the same one after (200)", async () => {
    const first = await resolve({ google_sub: "1082", email: "ada@example.com", name: "Ada" });
    expect(first.statusCode).toBe(201);
    const m = first.json();
    expect(m).toMatchObject({ name: "Ada", email: "ada@example.com", settlement_verified: false, settlement_address: null });
    expect(m.id).toBeTruthy();

    const again = await resolve({ google_sub: "1082", email: "ada@example.com", name: "Ada" });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(m.id);
  });

  it("keys on the Google sub, not the email", async () => {
    const a = (await resolve({ google_sub: "sub-a", email: "shared@example.com" })).json();
    const b = (await resolve({ google_sub: "sub-b", email: "shared@example.com" })).json();
    expect(b.id).not.toBe(a.id);
    // The second account cannot take the first's email, and never links to it.
    expect(b.email).toBe("shared+sub-b@example.com");
    // A changed email on a known sub does not create a new merchant.
    const moved = await resolve({ google_sub: "sub-a", email: "new@example.com" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().id).toBe(a.id);
  });

  it("does not link a sign-in to an operator-created merchant with the same email", async () => {
    const { merchant: cli } = await merchant(t.db, { email: "owner@acme.test" });
    const res = await resolve({ google_sub: "sub-x", email: "owner@acme.test" });
    expect(res.statusCode).toBe(201);
    expect(res.json().id).not.toBe(cli.id);
  });

  it("survives first sign-ins racing", async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, () => resolve({ google_sub: "racer", email: "racer@example.com", name: "Racer" })),
    );
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 201)).toBe(true);
    expect(new Set(results.map((r) => r.json().id)).size).toBe(1);
    expect(await t.db.merchant.count({ where: { googleSub: "racer" } })).toBe(1);
  });

  it("rejects a missing, wrong or merchant key with 401", async () => {
    const body = { google_sub: "s", email: "a@b.com" };
    expect((await resolve(body, {})).statusCode).toBe(401);
    expect((await resolve(body, { authorization: "Bearer tp_wrong" })).statusCode).toBe(401);
    const { auth } = await merchant(t.db);
    expect((await resolve(body, auth)).statusCode).toBe(401);
    expect(await t.db.merchant.count({ where: { googleSub: "s" } })).toBe(0);
  });

  it("validates the body", async () => {
    const res = await resolve({ google_sub: "", email: "not-an-email" });
    expect(res.statusCode).toBe(400);
    expect(Object.keys(res.json().fields)).toEqual(expect.arrayContaining(["google_sub", "email"]));
  });

  it("gives a new merchant nothing it can spend: invoices are refused until a settlement address is verified", async () => {
    const m = (await resolve({ google_sub: "fresh", email: "fresh@example.com" })).json();
    const res = await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: as(m.id),
      payload: { amount_expected: "5.00", currency: "USD", reference: "r1" },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("platform key on /v1 routes", () => {
  it("acts for the merchant named in X-Tender-Merchant, and only that one", async () => {
    const a = (await resolve({ google_sub: "a", email: "a@example.com", name: "Account A" })).json();
    const b = (await resolve({ google_sub: "b", email: "b@example.com", name: "Account B" })).json();
    expect((await t.app.inject({ method: "GET", url: "/v1/merchant", headers: as(a.id) })).json().name).toBe("Account A");
    expect((await t.app.inject({ method: "GET", url: "/v1/merchant", headers: as(b.id) })).json().name).toBe("Account B");
  });

  it("two merchants cannot read each other's invoices by id", async () => {
    const { auth } = await merchant(t.db);
    const created = await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: auth,
      payload: { amount_expected: "5.00", currency: "USD", reference: "iso-1" },
    });
    expect(created.statusCode).toBe(201);
    const invoiceId = created.json().id;
    const other = (await resolve({ google_sub: "other", email: "other@example.com" })).json();

    const own = await t.app.inject({ method: "GET", url: `/v1/invoices/${invoiceId}`, headers: auth });
    expect(own.statusCode).toBe(200);
    const theirs = await t.app.inject({ method: "GET", url: `/v1/invoices/${invoiceId}`, headers: as(other.id) });
    expect(theirs.statusCode).toBe(404);
  });

  it("refuses the platform key without the merchant header, or with an unknown one, as 401 (not 404)", async () => {
    expect((await t.app.inject({ method: "GET", url: "/v1/merchant", headers: platform })).statusCode).toBe(401);
    const unknown = await t.app.inject({ method: "GET", url: "/v1/merchant", headers: as("mer_does_not_exist") });
    expect(unknown.statusCode).toBe(401);
    expect(unknown.json().error).toBe("unauthorized");
  });

  it("refuses a wrong platform key even with a real merchant id", async () => {
    const m = (await resolve({ google_sub: "c", email: "c@example.com" })).json();
    const res = await t.app.inject({
      method: "GET",
      url: "/v1/merchant",
      headers: { authorization: `Bearer tp_${"x".repeat(43)}`, "x-tender-merchant": m.id },
    });
    expect(res.statusCode).toBe(401);
  });

  it("does not let a merchant's own key pick another merchant via the header", async () => {
    const { auth } = await merchant(t.db, { name: "Mine" });
    const other = (await resolve({ google_sub: "d", email: "d@example.com", name: "Theirs" })).json();
    const res = await t.app.inject({ method: "GET", url: "/v1/merchant", headers: { ...auth, "x-tender-merchant": other.id } });
    expect(res.json().name).toBe("Mine");
  });

  it("keeps platform and merchant-key traffic in separate rate-limit buckets", async () => {
    const m = (await resolve({ google_sub: "rl", email: "rl@example.com" })).json();
    const { auth } = await merchant(t.db);
    await t.app.inject({ method: "GET", url: "/v1/merchant", headers: as(m.id) });
    await t.app.inject({ method: "GET", url: "/v1/merchant", headers: auth });
    const keys = await t.redis.keys("tender:rl:*");
    expect(keys.some((k) => k.includes(`platform:merchant:${m.id}`))).toBe(true);
    expect(keys.some((k) => k.includes("merchant:key:tk_live_"))).toBe(true);
  });
});

describe("TENDER_PLATFORM_KEY config", () => {
  const base = { AURORA_API_KEY: "x" };
  it("is optional", () => {
    expect(loadConfig(base).TENDER_PLATFORM_KEY).toBeUndefined();
  });
  it("refuses a key that is too short or has the wrong prefix", () => {
    expect(() => loadConfig({ ...base, TENDER_PLATFORM_KEY: "tp_short" })).toThrow(/TENDER_PLATFORM_KEY/);
    expect(() => loadConfig({ ...base, TENDER_PLATFORM_KEY: "xx_" + "a".repeat(43) })).toThrow(/TENDER_PLATFORM_KEY/);
    expect(loadConfig({ ...base, TENDER_PLATFORM_KEY: PLATFORM_KEY }).TENDER_PLATFORM_KEY).toBe(PLATFORM_KEY);
  });
});

describe("secrets in logs", () => {
  it("never writes the platform key, even when a request carrying it is logged", async () => {
    const { Writable } = await import("node:stream");
    const { pino } = await import("pino");
    const { loggerOptions } = await import("../src/lib/logger.js");
    const lines: string[] = [];
    const sink = new Writable({ write: (chunk, _e, cb) => (lines.push(String(chunk)), cb()) });
    const log = pino(loggerOptions("info", false), sink);
    log.info({ req: { headers: { authorization: `Bearer ${PLATFORM_KEY}` } }, headers: { authorization: `Bearer ${PLATFORM_KEY}` }, cfg: { platformKey: PLATFORM_KEY } }, "request");
    expect(lines.join("")).not.toContain(PLATFORM_KEY);
    expect(lines.join("")).toContain("[redacted]");
  });
});
