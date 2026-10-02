import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { authenticate, MAX_ACTIVE_KEYS } from "../src/services/merchant.service.js";
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

const get = (url: string, headers: Record<string, string>) => t.app.inject({ method: "GET", url, headers });
const bearer = (key: string) => ({ authorization: `Bearer ${key}` });

describe("API key endpoints", () => {
  it("issues a key that works, shows the plaintext once, and lists only the prefix", async () => {
    const { auth } = await merchant(t.db);
    const created = await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: auth });
    expect(created.statusCode).toBe(201);
    const { id, key, prefix, created_at } = created.json();
    expect(key).toMatch(/^tk_live_/);
    expect(key.startsWith(prefix)).toBe(true);
    expect(id).toMatch(/^key_/);
    expect(created_at).toBeTruthy();

    // The new key authenticates.
    expect((await get("/v1/merchant", bearer(key))).statusCode).toBe(200);

    // The list never contains the plaintext or the hash.
    const list = await get("/v1/merchant/api-keys", auth);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(key);
    expect(list.body).not.toMatch(/argon2|hash/);
    const row = list.json().data.find((k: { id: string }) => k.id === id);
    expect(row).toMatchObject({ id, prefix });
    expect(row.last_used_at).toBeTruthy(); // used once, above
  });

  it("rotates with no downtime: create new, use it, revoke the old, old stops at once", async () => {
    const { auth } = await merchant(t.db);
    const fresh = (await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: auth })).json();
    // Both work side by side.
    expect((await get("/v1/merchant", auth)).statusCode).toBe(200);
    expect((await get("/v1/merchant", bearer(fresh.key))).statusCode).toBe(200);

    const oldId = (await get("/v1/merchant/api-keys", bearer(fresh.key))).json().data.find((k: { id: string }) => k.id !== fresh.id).id;
    const del = await t.app.inject({ method: "DELETE", url: `/v1/merchant/api-keys/${oldId}`, headers: bearer(fresh.key) });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe("");

    expect((await get("/v1/merchant", auth)).statusCode).toBe(401);
    expect((await get("/v1/merchant", bearer(fresh.key))).statusCode).toBe(200);
    // Revoked keys drop out of the list.
    expect((await get("/v1/merchant/api-keys", bearer(fresh.key))).json().data.map((k: { id: string }) => k.id)).toEqual([fresh.id]);
  });

  it("404s when revoking a key that is not this merchant's, and leaves it working", async () => {
    const a = await merchant(t.db, { name: "A" });
    const b = await merchant(t.db, { name: "B" });
    const bKey = (await get("/v1/merchant/api-keys", b.auth)).json().data[0];
    const res = await t.app.inject({ method: "DELETE", url: `/v1/merchant/api-keys/${bKey.id}`, headers: a.auth });
    expect(res.statusCode).toBe(404);
    expect((await get("/v1/merchant", b.auth)).statusCode).toBe(200);
    // Same answer for an id that does not exist at all: no probing.
    expect((await t.app.inject({ method: "DELETE", url: "/v1/merchant/api-keys/key_nope", headers: a.auth })).statusCode).toBe(404);
    // And a key can be revoked only once.
    const own = (await get("/v1/merchant/api-keys", a.auth)).json().data[0];
    const second = await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: a.auth });
    expect(second.statusCode).toBe(201);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/merchant/api-keys/${own.id}`, headers: bearer(second.json().key) })).statusCode).toBe(204);
    expect((await t.app.inject({ method: "DELETE", url: `/v1/merchant/api-keys/${own.id}`, headers: bearer(second.json().key) })).statusCode).toBe(404);
  });

  it("caps active keys, and revoking frees a slot", async () => {
    const { auth } = await merchant(t.db);
    for (let i = 1; i < MAX_ACTIVE_KEYS; i++) {
      expect((await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: auth })).statusCode).toBe(201);
    }
    const over = await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: auth });
    expect(over.statusCode).toBe(409);
    const first = (await get("/v1/merchant/api-keys", auth)).json().data[0];
    await t.app.inject({ method: "DELETE", url: `/v1/merchant/api-keys/${first.id}`, headers: auth });
    expect((await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: auth })).statusCode).toBe(201);
  });

  it("works for the dashboard too: platform key acting for a signed-in merchant", async () => {
    const m = (
      await t.app.inject({
        method: "POST",
        url: "/internal/merchants/resolve",
        headers: bearer(PLATFORM_KEY),
        payload: { google_sub: "g1", email: "g1@example.com", name: "G One" },
      })
    ).json();
    const as = { ...bearer(PLATFORM_KEY), "x-tender-merchant": m.id };

    // A Google-created merchant starts with no key at all.
    expect((await get("/v1/merchant/api-keys", as)).json().data).toEqual([]);
    const created = await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys", headers: as });
    expect(created.statusCode).toBe(201);
    expect((await get("/v1/merchant", bearer(created.json().key))).json().id).toBe(m.id);
  });

  it("requires authentication", async () => {
    expect((await get("/v1/merchant/api-keys", {})).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/v1/merchant/api-keys" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "DELETE", url: "/v1/merchant/api-keys/key_x" })).statusCode).toBe(401);
    expect((await t.app.inject({ method: "POST", url: "/v1/merchant/webhook/secret" })).statusCode).toBe(401);
  });
});

describe("last_used_at", () => {
  it("is set on first use and written at most once a minute", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    const key = auth.authorization.split(" ")[1]!;
    const row = () => t.db.apiKey.findFirstOrThrow({ where: { merchantId: m.id } });
    expect((await row()).lastUsedAt).toBeNull();

    const t0 = new Date("2026-09-30T12:00:00Z");
    await authenticate(t.db, key, t0);
    expect((await row()).lastUsedAt).toEqual(t0);

    await authenticate(t.db, key, new Date(t0.getTime() + 30_000));
    expect((await row()).lastUsedAt).toEqual(t0); // inside the minute: no write

    const t2 = new Date(t0.getTime() + 61_000);
    await authenticate(t.db, key, t2);
    expect((await row()).lastUsedAt).toEqual(t2);
  });

  it("does not move for a wrong or revoked key", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    const key = auth.authorization.split(" ")[1]!;
    expect(await authenticate(t.db, key.slice(0, -1) + (key.endsWith("A") ? "B" : "A"))).toBeNull();
    expect((await t.db.apiKey.findFirstOrThrow({ where: { merchantId: m.id } })).lastUsedAt).toBeNull();
  });
});

describe("POST /v1/merchant/webhook/secret", () => {
  it("returns a new secret once, stores it, and never puts it in GET /v1/merchant", async () => {
    const { merchant: m, auth } = await merchant(t.db);
    const before = (await t.db.merchant.findUniqueOrThrow({ where: { id: m.id } })).webhookSecret;
    const res = await t.app.inject({ method: "POST", url: "/v1/merchant/webhook/secret", headers: auth });
    expect(res.statusCode).toBe(201);
    const { webhook_secret } = res.json();
    expect(webhook_secret).toMatch(/^whsec_/);
    expect(webhook_secret).not.toBe(before);
    expect((await t.db.merchant.findUniqueOrThrow({ where: { id: m.id } })).webhookSecret).toBe(webhook_secret);
    expect((await get("/v1/merchant", auth)).body).not.toContain(webhook_secret);
  });

  it("rotates only the calling merchant's secret", async () => {
    const a = await merchant(t.db, { name: "A" });
    const b = await merchant(t.db, { name: "B" });
    const bBefore = (await t.db.merchant.findUniqueOrThrow({ where: { id: b.merchant.id } })).webhookSecret;
    await t.app.inject({ method: "POST", url: "/v1/merchant/webhook/secret", headers: a.auth });
    expect((await t.db.merchant.findUniqueOrThrow({ where: { id: b.merchant.id } })).webhookSecret).toBe(bBefore);
  });
});

describe("migration safety", () => {
  it("keeps the schema free of a plaintext or per-merchant key column", async () => {
    const cols = await t.db.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'Merchant'`,
    );
    expect(cols.map((c) => c.column_name)).not.toContain("apiKeyHash");
    expect(cols.map((c) => c.column_name)).not.toContain("apiKeyPrefix");
  });
});
