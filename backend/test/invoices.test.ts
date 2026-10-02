import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as S from "../contract/schemas.js";
import { merchant, resetDb, setupApp, SETTLEMENT, teardown, type TestContext } from "./helpers.js";

let t: TestContext;

beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  t.aurora.mintAddress.mockClear();
});

const ORDER = { amount_expected: "49.00", currency: "USD", reference: "order_8842", redirect_url: "https://shop.test/thanks" };

async function create(auth: Record<string, string>, body: object = ORDER) {
  return t.app.inject({ method: "POST", url: "/v1/invoices", headers: auth, payload: body });
}

describe("auth", () => {
  it("rejects a missing, malformed or unknown key", async () => {
    for (const headers of [{}, { authorization: "Basic abc" }, { authorization: "Bearer tk_live_nope_nope_nope_nope" }]) {
      const res = await t.app.inject({ method: "GET", url: "/v1/merchant", headers });
      expect(res.statusCode).toBe(401);
    }
  });

  it("returns the merchant for a valid key, in the contract shape", async () => {
    const m = await merchant(t.db, { name: "Acme Store" });
    const res = await t.app.inject({ method: "GET", url: "/v1/merchant", headers: m.auth });
    expect(res.statusCode).toBe(200);
    const body = S.Merchant.parse(res.json());
    expect(body).toMatchObject({ name: "Acme Store", settlement_address: SETTLEMENT, settlement_verified: true });
    expect(res.body).not.toMatch(/apiKey|webhookSecret|whsec_/);
  });
});

describe("POST /v1/invoices", () => {
  it("creates an invoice with one address per accepted chain", async () => {
    const m = await merchant(t.db);
    const res = await create(m.auth, { ...ORDER, chains: ["solana", "base", "arbitrum", "bitcoin"] });

    expect(res.statusCode).toBe(201);
    const inv = S.Invoice.parse(res.json());
    expect(inv.id).toMatch(/^inv_/);
    expect(inv.token).toMatch(/^chk_[0-9A-Za-z]{27}$/);
    expect(inv).toMatchObject({ status: "PENDING", amount_expected: "49.00", currency: "USD", reference: "order_8842" });
    expect(inv.addresses.map((a) => a.chain)).toEqual(["solana", "base", "arbitrum", "bitcoin"]);

    // Base and Arbitrum share the one EVM address.
    const addr = Object.fromEntries(inv.addresses.map((a) => [a.chain, a.address]));
    expect(addr.base).toBe(addr.arbitrum);
    expect(addr.solana).not.toBe(addr.base);

    // One mint per family, with the invoice id as sender, paying the merchant on Monad.
    expect(t.aurora.mintAddress).toHaveBeenCalledTimes(3);
    for (const [call] of t.aurora.mintAddress.mock.calls) {
      expect(call).toMatchObject({ sender: inv.id, recipient: SETTLEMENT, destinationChain: "monad", destinationAsset: "USDC" });
    }
  });

  it("accepts every supported chain by default", async () => {
    const m = await merchant(t.db);
    const inv = S.Invoice.parse((await create(m.auth)).json());
    // Every EVM chain (they share one address) plus Bitcoin, Solana and Tron. The other
    // non-EVM chains are opt-in: each costs its own Aurora mint call per invoice.
    expect(inv.addresses.map((a) => a.chain).sort()).toEqual([
      "adi", "arbitrum", "avalanche", "base", "berachain", "bitcoin", "bnb", "ethereum", "gnosis",
      "monad", "optimism", "plasma", "polygon", "scroll", "solana", "tron", "xlayer",
    ]);
    expect(t.aurora.mintAddress).toHaveBeenCalledTimes(4); // evm, sol, btc, tron
  });

  it("mints one family at a time, because Aurora answers 429 to concurrent mints for the same sender", async () => {
    const m = await merchant(t.db);
    let inFlight = 0;
    let maxInFlight = 0;
    const real = t.aurora.mintAddress.getMockImplementation()!;
    t.aurora.mintAddress.mockImplementation(async (input) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return real(input);
    });
    try {
      const res = await create(m.auth, { ...ORDER, reference: "sequential-1", chains: ["bitcoin", "solana", "tron", "base"] });
      expect(res.statusCode).toBe(201);
      expect(maxInFlight).toBe(1);
      expect(t.aurora.mintAddress).toHaveBeenCalledTimes(4);
    } finally {
      t.aurora.mintAddress.mockImplementation(real);
    }
  });

  it("is idempotent on reference: a retry returns the same invoice and mints nothing", async () => {
    const m = await merchant(t.db);
    const first = await create(m.auth);
    t.aurora.mintAddress.mockClear();
    const retry = await create(m.auth);

    expect(retry.statusCode).toBe(200);
    expect(retry.json().id).toBe(first.json().id);
    expect(t.aurora.mintAddress).not.toHaveBeenCalled();
  });

  it("returns one invoice when the same create races itself", async () => {
    const m = await merchant(t.db);
    const [a, b] = await Promise.all([create(m.auth), create(m.auth)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(a.json().id).toBe(b.json().id);
    expect(await t.db.invoice.count()).toBe(1);
  });

  it("refuses to reuse a reference for a different amount", async () => {
    const m = await merchant(t.db);
    await create(m.auth);
    const res = await create(m.auth, { ...ORDER, amount_expected: "50.00" });
    expect(res.statusCode).toBe(409);
  });

  it("refuses to route payments to an unverified settlement address", async () => {
    const m = await merchant(t.db, { verified: false });
    const res = await create(m.auth);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("settlement_not_verified");
    expect(t.aurora.mintAddress).not.toHaveBeenCalled();
  });

  it("validates the body and names the failing fields", async () => {
    const m = await merchant(t.db);
    const cases: Array<[object, string]> = [
      [{ ...ORDER, amount_expected: 49 }, "amount_expected"],
      [{ ...ORDER, amount_expected: "0.00" }, "amount_expected"],
      [{ ...ORDER, amount_expected: "1e3" }, "amount_expected"],
      [{ ...ORDER, currency: "EUR" }, "currency"],
      [{ ...ORDER, chains: ["stellar"] }, "chains"],
      [{ ...ORDER, redirect_url: "javascript:alert(1)" }, "redirect_url"],
      [{ amount_expected: "1.00", currency: "USD" }, "reference"],
    ];
    for (const [body, field] of cases) {
      const res = await create(m.auth, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(Object.keys(res.json().fields)).toContain(field);
    }
    expect(await t.db.invoice.count()).toBe(0);
  });

  it("writes nothing when Aurora fails, so the merchant can retry", async () => {
    const m = await merchant(t.db);
    t.aurora.mintAddress.mockRejectedValueOnce(new (await import("../src/aurora/client.js")).AuroraError("upstream", "down", 503));
    const res = await create(m.auth);
    expect(res.statusCode).toBe(502);
    expect(await t.db.invoice.count()).toBe(0);
  });
});

describe("reading and cancelling", () => {
  it("never shows one merchant's invoice to another", async () => {
    const a = await merchant(t.db);
    const b = await merchant(t.db);
    const inv = (await create(a.auth)).json();
    const res = await t.app.inject({ method: "GET", url: `/v1/invoices/${inv.id}`, headers: b.auth });
    expect(res.statusCode).toBe(404);
  });

  it("returns a single invoice with its payments", async () => {
    const m = await merchant(t.db);
    const inv = (await create(m.auth)).json();
    const res = await t.app.inject({ method: "GET", url: `/v1/invoices/${inv.id}`, headers: m.auth });
    expect(res.statusCode).toBe(200);
    expect(S.Invoice.parse(res.json()).payments).toEqual([]);
  });

  it("paginates the list newest first", async () => {
    const m = await merchant(t.db);
    for (let i = 0; i < 5; i++) await create(m.auth, { ...ORDER, reference: `order_${i}` });

    const first = await t.app.inject({ method: "GET", url: "/v1/invoices?limit=2", headers: m.auth });
    const page1 = S.paginated(S.Invoice).parse(first.json());
    expect(page1.data.map((i) => i.reference)).toEqual(["order_4", "order_3"]);
    expect(page1.has_more).toBe(true);

    const second = await t.app.inject({ method: "GET", url: `/v1/invoices?limit=2&cursor=${page1.next_cursor}`, headers: m.auth });
    expect(S.paginated(S.Invoice).parse(second.json()).data.map((i) => i.reference)).toEqual(["order_2", "order_1"]);
  });

  it("cancels a pending invoice exactly once", async () => {
    const m = await merchant(t.db);
    const inv = (await create(m.auth)).json();
    const url = `/v1/invoices/${inv.id}/cancel`;

    const res = await t.app.inject({ method: "POST", url, headers: m.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("CANCELLED");

    const again = await t.app.inject({ method: "POST", url, headers: m.auth });
    expect(again.statusCode).toBe(409);
  });

  it("treats an overdue pending invoice as EXPIRED everywhere", async () => {
    const m = await merchant(t.db);
    const inv = (await create(m.auth)).json();
    await t.db.invoice.update({ where: { id: inv.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const pub = await t.app.inject({ method: "GET", url: `/public/invoices/${inv.token}` });
    expect(pub.json().status).toBe("EXPIRED");

    const expired = await t.app.inject({ method: "GET", url: "/v1/invoices?status=EXPIRED", headers: m.auth });
    expect(expired.json().data).toHaveLength(1);
    const pending = await t.app.inject({ method: "GET", url: "/v1/invoices?status=PENDING", headers: m.auth });
    expect(pending.json().data).toHaveLength(0);

    const cancel = await t.app.inject({ method: "POST", url: `/v1/invoices/${inv.id}/cancel`, headers: m.auth });
    expect(cancel.statusCode).toBe(409);
  });
});

describe("GET /public/invoices/:token", () => {
  it("returns exactly the public fields — nothing merchant-private", async () => {
    const m = await merchant(t.db, { name: "Acme Store" });
    const inv = (await create(m.auth)).json();

    const res = await t.app.inject({ method: "GET", url: `/public/invoices/${inv.token}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");

    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(
      ["addresses", "amount_expected", "currency", "expires_at", "merchant_name", "redirect_url", "status", "token"],
    );
    expect(S.PublicInvoice.parse(body)).toMatchObject({ merchant_name: "Acme Store", status: "PENDING", amount_expected: "49.00" });

    // The audit the spec asks for (§12): no id, no reference, no email, no settlement address.
    expect(res.body).not.toContain(inv.id);
    expect(res.body).not.toContain("order_8842");
    expect(res.body).not.toContain(m.merchant.email);
    expect(res.body).not.toContain(SETTLEMENT);
  });

  it("needs no API key", async () => {
    const m = await merchant(t.db);
    const inv = (await create(m.auth)).json();
    const res = await t.app.inject({ method: "GET", url: `/public/invoices/${inv.token}` });
    expect(res.statusCode).toBe(200);
  });

  it("404s on unknown and malformed tokens, and never accepts an invoice id", async () => {
    const m = await merchant(t.db);
    const inv = (await create(m.auth)).json();
    for (const token of ["chk_AAAAAAAAAAAAAAAAAAAAAAAAAAA", "not-a-token", inv.id]) {
      const res = await t.app.inject({ method: "GET", url: `/public/invoices/${token}` });
      expect(res.statusCode).toBe(404);
    }
  });
});
