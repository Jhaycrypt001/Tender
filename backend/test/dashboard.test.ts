import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as S from "../contract/schemas.js";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.redis.flushdb();
});

describe("GET /v1/merchant/balance", () => {
  it("sums what landed, and values what is still in flight", async () => {
    const m = await merchant(t.db);
    const create = (ref: string) =>
      t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload: { amount_expected: "49.00", currency: "USD", reference: ref, chains: ["base"] } });
    const a = (await create("a")).json().addresses[0].address as string;
    const b = (await create("b")).json().addresses[0].address as string;

    t.aurora.push(a, "received", deposit(a, { asset: ASSETS.USDC_BASE, amount: "49000000" }));
    t.aurora.push(a, "success", deposit(a, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
    t.aurora.push(b, "received", deposit(b, { asset: ASSETS.USDC_BASE, amount: "20000000" }));
    await makePoller(t).poller.tick();

    const res = await t.app.inject({ method: "GET", url: "/v1/merchant/balance", headers: m.auth });
    expect(S.Balance.parse(res.json())).toEqual({
      settled: [{ asset: "USDC", amount: "48.80" }],
      unsettled: [{ asset: "USD", amount: "20.00" }],
      display_total: { currency: "USD", amount: "48.80" },
    });
  });

  it("is zero, not absent, for a new merchant", async () => {
    const m = await merchant(t.db);
    const res = await t.app.inject({ method: "GET", url: "/v1/merchant/balance", headers: m.auth });
    expect(res.json().settled).toEqual([{ asset: "USDC", amount: "0.00" }]);
  });
});

describe("payment links", () => {
  it("creates and lists links, and each buyer who opens one gets their own invoice", async () => {
    const m = await merchant(t.db);
    const created = await t.app.inject({ method: "POST", url: "/v1/links", headers: m.auth, payload: { label: "T-shirt", amount: "25.00", currency: "USD" } });
    expect(created.statusCode).toBe(201);
    const link = S.PaymentLink.parse(created.json());
    expect(link).toMatchObject({ label: "T-shirt", amount: "25.00", uses: 0, active: true });
    expect(link.token).toMatch(/^pl_[0-9A-Za-z]{27}$/);

    const [one, two] = await Promise.all([
      t.app.inject({ method: "POST", url: `/public/links/${link.token}` }),
      t.app.inject({ method: "POST", url: `/public/links/${link.token}` }),
    ]);
    expect(one.statusCode).toBe(201);
    expect(one.json().token).not.toBe(two.json().token);

    const pub = await t.app.inject({ method: "GET", url: `/public/invoices/${one.json().token}` });
    expect(pub.json()).toMatchObject({ amount_expected: "25.00", merchant_name: "Acme Store" });

    const list = await t.app.inject({ method: "GET", url: "/v1/links", headers: m.auth });
    expect(S.paginated(S.PaymentLink).parse(list.json()).data[0]!.uses).toBe(2);
  });

  it("takes the buyer's amount on an open-amount link, and requires one", async () => {
    const m = await merchant(t.db);
    const link = (await t.app.inject({ method: "POST", url: "/v1/links", headers: m.auth, payload: { label: "Tip jar", currency: "USD" } })).json();
    expect(link.amount).toBeNull();

    const missing = await t.app.inject({ method: "POST", url: `/public/links/${link.token}` });
    expect(missing.statusCode).toBe(400);

    const ok = await t.app.inject({ method: "POST", url: `/public/links/${link.token}`, payload: { amount: "5.00" } });
    const pub = await t.app.inject({ method: "GET", url: `/public/invoices/${ok.json().token}` });
    expect(pub.json().amount_expected).toBe("5.00");
  });

  it("404s on unknown links", async () => {
    const res = await t.app.inject({ method: "POST", url: "/public/links/pl_AAAAAAAAAAAAAAAAAAAAAAAAAAA" });
    expect(res.statusCode).toBe(404);
  });
});

describe("ramps and earn say what is true", () => {
  it("lists no live corridors and no positions, and refuses an Earn deposit plainly", async () => {
    const m = await merchant(t.db);
    expect((await t.app.inject({ method: "GET", url: "/v1/ramps/corridors", headers: m.auth })).json()).toEqual([]);
    expect((await t.app.inject({ method: "GET", url: "/v1/earn/positions", headers: m.auth })).json()).toEqual([]);
    const deposit = await t.app.inject({ method: "POST", url: "/v1/earn/deposit", headers: m.auth, payload: {} });
    expect(deposit.statusCode).toBe(501);
  });
});

describe("rate limits", () => {
  it("caps submit-tx per client, with the flat error shape", async () => {
    const m = await merchant(t.db);
    const inv = (
      await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload: { amount_expected: "1.00", currency: "USD", reference: "rl" } })
    ).json();
    const url = `/public/invoices/${inv.token}/submit-tx`;
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await t.app.inject({ method: "POST", url, payload: { tx_hash: "0xabc123def456" } })).statusCode);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);

    const limited = await t.app.inject({ method: "POST", url, payload: { tx_hash: "0xabc123def456" } });
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
    // Other routes are unaffected.
    expect((await t.app.inject({ method: "GET", url: `/public/invoices/${inv.token}` })).statusCode).toBe(200);
  });
});

describe("GET /metrics", () => {
  it("exposes Prometheus metrics with route templates, never raw ids", async () => {
    const m = await merchant(t.db);
    const inv = (
      await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload: { amount_expected: "1.00", currency: "USD", reference: "mx" } })
    ).json();
    await t.app.inject({ method: "GET", url: `/public/invoices/${inv.token}` });

    const res = await t.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("tender_http_request_seconds");
    expect(res.body).toContain('route="/public/invoices/:token"');
    expect(res.body).not.toContain(inv.token);
  });
});
