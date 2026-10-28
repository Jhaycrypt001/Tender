import { generateKeyPairSync, sign } from "node:crypto";
import { Writable } from "node:stream";
import stringify from "fast-json-stable-stringify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as S from "../contract/schemas.js";
import { merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
const signed = (body: object) => ({ "x-body-signature": sign("sha256", Buffer.from(stringify(body)), privateKey).toString("base64") });

/** Every log line the app writes, parsed, so a test can check what an operator would see (and not see). */
const lines: { msg: string; level: number; [k: string]: unknown }[] = [];
const logStream = new Writable({
  write(chunk, _enc, cb) {
    for (const raw of chunk.toString().split("\n")) if (raw.trim()) lines.push(JSON.parse(raw));
    cb();
  },
});

let t: TestContext;
beforeAll(async () => {
  t = await setupApp({ LOG_LEVEL: "info" }, { rampWebhookKey: publicKey, logStream });
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.db.rampSale.deleteMany();
  await t.redis.flushdb();
  lines.splice(0);
});

type M = Awaited<ReturnType<typeof merchant>>;

/** The merchant's webhook path, exactly as the dashboard would get it for the widget. */
async function widgetPath(m: M): Promise<string> {
  const res = await t.app.inject({ method: "GET", url: "/v1/ramps/widget", headers: m.auth });
  expect(res.statusCode).toBe(200);
  return S.RampWidget.parse(res.json()).webhook_path;
}

/** A Ramp off-ramp event in the shape their docs show: amounts in the token's base units. */
function event(type: "CREATED" | "RELEASED" | "EXPIRED", over: { saleId?: string; eventId?: string; mode?: string; fiat?: string } = {}) {
  return {
    id: over.eventId ?? `evt_${Math.random().toString(36).slice(2)}`,
    type,
    mode: over.mode ?? "OFFRAMP",
    payload: {
      id: over.saleId ?? "sale_1",
      saleViewToken: "view_token",
      transactionHash: "0xabc123",
      createdAt: "2026-10-28T10:00:00.000Z",
      fees: { amount: "0.5", currencySymbol: "USD" },
      crypto: { amount: "25000000" as string | number, status: "RECEIVED", assetInfo: { address: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", symbol: "USDC", chain: "MONAD", type: "ERC20", name: "USD Coin", decimals: 6 } },
      fiat: { amount: over.fiat ?? "24.50", currencySymbol: "USD", status: "PENDING", payoutMethod: "BANK_TRANSFER" },
    },
  };
}

/** POST to the webhook as the merchant's own widget would (their path), or to a raw URL, or with no token. */
const post = async (body: object, to: M | string | undefined, headers: Record<string, string> = signed(body)) => {
  const url = to === undefined ? "/webhooks/ramp" : typeof to === "string" ? to : await widgetPath(to);
  return t.app.inject({ method: "POST", url, headers, payload: body });
};

describe("GET /v1/ramps/widget", () => {
  it("gives each merchant one stable token of its own, and never their merchant id", async () => {
    const a = await merchant(t.db);
    const b = await merchant(t.db);
    const first = await widgetPath(a);
    expect(first).toMatch(/^\/webhooks\/ramp\?t=rwt_[0-9A-Za-z]{27}$/);
    expect(first).not.toContain(a.merchant.id);
    expect(await widgetPath(a)).toBe(first);
    expect(await widgetPath(b)).not.toBe(first);
  });

  it("agrees on one token when the first requests arrive together", async () => {
    const m = await merchant(t.db);
    const paths = await Promise.all(Array.from({ length: 6 }, () => widgetPath(m)));
    expect(new Set(paths).size).toBe(1);
  });

  it("needs a merchant key", async () => {
    expect((await t.app.inject({ method: "GET", url: "/v1/ramps/widget" })).statusCode).toBe(401);
  });
});

describe("POST /webhooks/ramp", () => {
  it("records a signed sale for the merchant whose token is in the URL, converting base units to whole tokens", async () => {
    const m = await merchant(t.db);
    const res = await post(event("CREATED"), m);
    expect(res.statusCode).toBe(204);

    const row = await t.db.rampSale.findUniqueOrThrow({ where: { rampSaleId: "sale_1" } });
    expect(row).toMatchObject({ merchantId: m.merchant.id, status: "CREATED", cryptoSymbol: "USDC", cryptoChain: "MONAD", fiatCurrency: "USD", payoutMethod: "BANK_TRANSFER", transactionHash: "0xabc123" });
    expect(row.cryptoAmount.toString()).toBe("25");
    expect(row.fiatAmount.toString()).toBe("24.5");
    expect(row.id).toMatch(/^rsl_[0-9A-Za-z]{17}$/);
  });

  it("cannot be filed under another merchant by putting their merchant id in the URL", async () => {
    const victim = await merchant(t.db);
    // The attack the token exists for: an attacker opens Ramp's widget themselves and names the victim.
    expect((await post(event("RELEASED", { saleId: "by_id" }), `/webhooks/ramp?merchant=${victim.merchant.id}`)).statusCode).toBe(204);
    expect((await post(event("RELEASED", { saleId: "by_id_as_t" }), `/webhooks/ramp?t=${victim.merchant.id}`)).statusCode).toBe(204);

    expect((await t.db.rampSale.findMany()).map((r) => r.merchantId)).toEqual([null, null]);
    const list = await t.app.inject({ method: "GET", url: "/v1/ramps/sales", headers: victim.auth });
    expect(list.json().data).toEqual([]);
  });

  it("stores nothing for a missing, wrong, tampered or foreign signature, and says 401", async () => {
    const m = await merchant(t.db);
    const body = event("RELEASED");
    const other = generateKeyPairSync("ec", { namedCurve: "secp256k1" });
    const foreign = { "x-body-signature": sign("sha256", Buffer.from(stringify(body)), other.privateKey).toString("base64") };

    expect((await post(body, m, {})).statusCode).toBe(401);
    expect((await post(body, m, { "x-body-signature": "AAAA" })).statusCode).toBe(401);
    expect((await post(body, m, foreign)).statusCode).toBe(401);
    // Signed for 24.50, sent as 2400.00: the signature no longer covers what arrived.
    const tampered = { ...body, payload: { ...body.payload, fiat: { ...body.payload.fiat, amount: "2400.00" } } };
    expect((await post(tampered, m, signed(body))).statusCode).toBe(401);

    expect(await t.db.rampSale.count()).toBe(0);
  });

  it("logs a flood of rejected requests as one line, not one per request", async () => {
    // Its own address: the mute is per caller, and earlier tests already sent rejected requests from 127.0.0.1.
    for (let i = 0; i < 10; i++) {
      const res = await t.app.inject({ method: "POST", url: "/webhooks/ramp", remoteAddress: "203.0.113.7", headers: { "x-body-signature": "AAAA" }, payload: event("RELEASED") });
      expect(res.statusCode).toBe(401);
    }
    expect(lines.filter((l) => l.msg.startsWith("ramp webhook rejected") && l.ip === "203.0.113.7")).toHaveLength(1);
  });

  it("never writes the webhook token into a log line", async () => {
    const m = await merchant(t.db);
    const path = await widgetPath(m);
    const token = path.split("t=")[1]!;
    await post(event("CREATED"), path);
    await post(event("RELEASED"), path, { "x-body-signature": "AAAA" });
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.stringify(lines)).not.toContain(token);
  });

  it("records a retried event once", async () => {
    const m = await merchant(t.db);
    const path = await widgetPath(m);
    const body = event("CREATED", { eventId: "evt_same" });
    for (let i = 0; i < 3; i++) expect((await post(body, path)).statusCode).toBe(204);
    expect(await t.db.rampSale.count()).toBe(1);
  });

  it("records one row when the same event arrives several times at once", async () => {
    const m = await merchant(t.db);
    const path = await widgetPath(m);
    const body = event("CREATED");
    const results = await Promise.all(Array.from({ length: 6 }, () => post(body, path)));
    expect(results.map((r) => r.statusCode)).toEqual([204, 204, 204, 204, 204, 204]);
    expect(await t.db.rampSale.count()).toBe(1);
  });

  it("moves a sale forward when Ramp reports it released, and updates the figures Ramp now stands behind", async () => {
    const m = await merchant(t.db);
    await post(event("CREATED"), m);
    await post(event("RELEASED", { fiat: "24.10" }), m);
    const row = await t.db.rampSale.findUniqueOrThrow({ where: { rampSaleId: "sale_1" } });
    expect(row.status).toBe("RELEASED");
    expect(row.fiatAmount.toString()).toBe("24.1");
  });

  it("never moves a sale backwards: a late CREATED retry cannot undo a release", async () => {
    const m = await merchant(t.db);
    await post(event("CREATED"), m);
    await post(event("RELEASED"), m);
    expect((await post(event("CREATED"), m)).statusCode).toBe(204);
    expect((await t.db.rampSale.findUniqueOrThrow({ where: { rampSaleId: "sale_1" } })).status).toBe("RELEASED");
  });

  it("keeps the first final state: a sale released is not later called expired, nor the reverse", async () => {
    const m = await merchant(t.db);
    await post(event("CREATED", { saleId: "a" }), m);
    await post(event("RELEASED", { saleId: "a" }), m);
    await post(event("EXPIRED", { saleId: "a" }), m);
    await post(event("EXPIRED", { saleId: "b" }), m);
    await post(event("RELEASED", { saleId: "b" }), m);
    const status = async (id: string) => (await t.db.rampSale.findUniqueOrThrow({ where: { rampSaleId: id } })).status;
    expect([await status("a"), await status("b")]).toEqual(["RELEASED", "EXPIRED"]);
  });

  it("keeps a signed sale whose token is unknown or missing, unattributed and out of every list", async () => {
    const m = await merchant(t.db);
    expect((await post(event("RELEASED", { saleId: "orphan" }), `/webhooks/ramp?t=rwt_${"A".repeat(27)}`)).statusCode).toBe(204);
    expect((await post(event("RELEASED", { saleId: "no_param" }), undefined)).statusCode).toBe(204);

    const rows = await t.db.rampSale.findMany({ orderBy: { rampSaleId: "asc" } });
    expect(rows.map((r) => [r.rampSaleId, r.merchantId])).toEqual([["no_param", null], ["orphan", null]]);
    const list = await t.app.inject({ method: "GET", url: "/v1/ramps/sales", headers: m.auth });
    expect(list.json().data).toEqual([]);
  });

  it("does not move a sale to another merchant once it is filed", async () => {
    const owner = await merchant(t.db);
    const other = await merchant(t.db);
    await post(event("CREATED"), owner);
    await post(event("RELEASED"), other);
    expect((await t.db.rampSale.findUniqueOrThrow({ where: { rampSaleId: "sale_1" } })).merchantId).toBe(owner.merchant.id);
  });

  it("acknowledges, without storing, an event that is not an off-ramp state we record", async () => {
    const m = await merchant(t.db);
    expect((await post(event("RELEASED", { mode: "ONRAMP" }), m)).statusCode).toBe(204);
    expect((await post({ ...event("CREATED"), type: "SOMETHING_NEW" }, m)).statusCode).toBe(204);
    expect(await t.db.rampSale.count()).toBe(0);
  });

  it("takes the crypto amount as a JSON number while it is exact, and refuses it once it is not", async () => {
    const m = await merchant(t.db);
    const asNumber = event("CREATED", { saleId: "num" });
    asNumber.payload.crypto.amount = 25000000;
    expect((await post(asNumber, m)).statusCode).toBe(204);
    expect((await t.db.rampSale.findUniqueOrThrow({ where: { rampSaleId: "num" } })).cryptoAmount.toString()).toBe("25");

    // 2^53 + 2: JSON can still say it, but not as a safe integer, so it is not trusted.
    const unsafe = event("CREATED", { saleId: "unsafe" });
    unsafe.payload.crypto.amount = 9007199254740994;
    expect((await post(unsafe, m)).statusCode).toBe(400);
    expect(await t.db.rampSale.count({ where: { rampSaleId: "unsafe" } })).toBe(0);
  });

  it("answers 400, and stores nothing, for a signed event it cannot read", async () => {
    const m = await merchant(t.db);
    const broken = { id: "evt_x", type: "CREATED", mode: "OFFRAMP", payload: { id: "sale_x" } };
    expect((await post(broken, m)).statusCode).toBe(400);
    const badAmount = event("CREATED");
    badAmount.payload.crypto.amount = "1.5";
    expect((await post(badAmount, m)).statusCode).toBe(400);
    expect(await t.db.rampSale.count()).toBe(0);
  });
});

describe("GET /v1/ramps/sales", () => {
  it("lists a merchant's own cash-outs newest first, as money out, and no one else's", async () => {
    const mine = await merchant(t.db);
    const theirs = await merchant(t.db);
    await post(event("RELEASED", { saleId: "first" }), mine);
    await post(event("CREATED", { saleId: "second" }), mine);
    await post(event("RELEASED", { saleId: "theirs" }), theirs);

    const res = await t.app.inject({ method: "GET", url: "/v1/ramps/sales", headers: mine.auth });
    const page = S.paginated(S.RampSale).parse(res.json());
    expect(page.data).toHaveLength(2);
    expect(page.data.map((s) => s.status).sort()).toEqual(["CREATED", "RELEASED"]);
    expect(page.data[0]).toMatchObject({ crypto: { asset: "USDC", chain: "MONAD", amount: "25.00" }, fiat: { currency: "USD", amount: "24.50" }, payout_method: "BANK_TRANSFER", tx_hash: "0xabc123" });
    expect(Object.keys(page.data[0]!)).not.toContain("merchantId");
    expect(page.has_more).toBe(false);
  });

  it("never appears among payments received: a withdrawal is not revenue", async () => {
    const m = await merchant(t.db);
    await post(event("RELEASED"), m);
    const payments = await t.app.inject({ method: "GET", url: "/v1/payments", headers: m.auth });
    expect(payments.json().data).toEqual([]);
    const balance = await t.app.inject({ method: "GET", url: "/v1/merchant/balance", headers: m.auth });
    expect(balance.json().settled).toEqual([{ asset: "USDC", amount: "0.00" }]);
  });

  it("pages with a cursor", async () => {
    const m = await merchant(t.db);
    const path = await widgetPath(m);
    for (const id of ["s1", "s2", "s3"]) await post(event("RELEASED", { saleId: id }), path);
    const first = S.paginated(S.RampSale).parse((await t.app.inject({ method: "GET", url: "/v1/ramps/sales?limit=2", headers: m.auth })).json());
    expect(first.data).toHaveLength(2);
    expect(first.has_more).toBe(true);
    const second = S.paginated(S.RampSale).parse((await t.app.inject({ method: "GET", url: `/v1/ramps/sales?limit=2&cursor=${first.next_cursor}`, headers: m.auth })).json());
    expect(second.data).toHaveLength(1);
    expect(second.has_more).toBe(false);
  });

  it("needs a merchant key", async () => {
    expect((await t.app.inject({ method: "GET", url: "/v1/ramps/sales" })).statusCode).toBe(401);
  });
});
