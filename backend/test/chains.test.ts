import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as S from "../contract/schemas.js";
import { describeEta, measureCatalogue, saveCatalogue } from "../src/services/chains.service.js";
import { createLogger } from "../src/lib/logger.js";
import { merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** Minimum routable USD per asset, as a fake Aurora enforces it. */
const FLOORS: Record<string, number> = { "btc:BTC": 7.04, "sol:SOL": 0.12, "sol:USDC": 0.33, "base:USDC": 0.15 };

function quoteAurora() {
  const tokens = [
    { assetId: "monad-usdc", symbol: "USDC", blockchain: "monad", decimals: 6, price: 1 },
    { assetId: "btc", symbol: "BTC", blockchain: "btc", decimals: 8, price: 84_000 },
    { assetId: "sol", symbol: "SOL", blockchain: "sol", decimals: 9, price: 120 },
    { assetId: "sol-usdc", symbol: "USDC", blockchain: "sol", decimals: 6, price: 1 },
    { assetId: "base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
  ];
  const byId = new Map(tokens.map((t) => [t.assetId, t]));
  return {
    tokens: vi.fn(async () => tokens),
    mintAddress: vi.fn(async (input: { depositChain: string }) => ({ depositAddress: `probe-${input.depositChain}`, alreadyExists: true })),
    dryQuote: vi.fn(async (input: { originAsset: string; amount: string; refundTo: string }) => {
      const t = byId.get(input.originAsset)!;
      // Refunds must target the origin chain's probe address, never an Intents account.
      const family = ["btc", "sol", "tron"].includes(t.blockchain) ? t.blockchain : "evm";
      if (input.refundTo !== `probe-${family}`) throw new Error(`wrong refund target ${input.refundTo}`);
      const usd = (Number(input.amount) / 10 ** t.decimals) * t.price;
      const floor = FLOORS[`${t.blockchain}:${t.symbol}`] ?? Infinity;
      return usd >= floor ? { quote: { amountIn: input.amount, timeEstimate: t.blockchain === "btc" ? 809 : 40 } } : null;
    }),
  };
}

describe("measureCatalogue", () => {
  it("finds each chain's floor, takes the highest asset on it, and adds the margin", async () => {
    const catalogue = await measureCatalogue(quoteAurora(), {
      recipient: "0x1",
      marginBps: 2000,
      logger: createLogger("fatal", false),
      spacingMs: 0,
    });
    const byId = Object.fromEntries(catalogue.chains.map((c) => [c.id, c]));

    // floor × 1.2, never below it, and within the search precision (~3%) plus one cent of rounding up.
    const within = (min: string | undefined, floor: number) => {
      const v = Number(min);
      expect(v).toBeGreaterThanOrEqual(floor * 1.2);
      expect(v).toBeLessThanOrEqual(floor * 1.2 * 1.04 + 0.01);
    };
    within(byId.bitcoin?.minimum, 7.04);
    // Solana: USDC's $0.33 floor beats SOL's $0.12.
    within(byId.solana?.minimum, 0.33);
    within(byId.base?.minimum, 0.15);
    expect(byId.bitcoin?.etaSeconds).toBe(809);
    // Chains the fake cannot route are left out, never guessed.
    expect(byId.tron).toBeUndefined();
  });
});

describe("describeEta", () => {
  it("reads like a person", () => {
    expect(describeEta(40)).toBe("about a minute");
    expect(describeEta(809)).toBe("about 13 minutes");
    expect(describeEta(3900)).toBe("about an hour");
    expect(describeEta(null)).toBe("a few minutes");
  });
});

describe("GET /public/chains and address minimums", () => {
  let t: TestContext;
  beforeAll(async () => {
    t = await setupApp();
  });
  afterAll(() => teardown(t));
  beforeEach(async () => {
    await resetDb(t.db);
    await t.redis.del("tender:chain-catalogue");
  });

  it("is 503 until minimums have been measured — never a made-up number", async () => {
    const res = await t.app.inject({ method: "GET", url: "/public/chains" });
    expect(res.statusCode).toBe(503);
  });

  it("serves the measured catalogue in the contract shape, and decorates invoice addresses", async () => {
    await saveCatalogue(t.redis, {
      measuredAt: new Date().toISOString(),
      chains: [
        { id: "bitcoin", name: "Bitcoin", asset: "BTC", minimum: "8.45", etaSeconds: 809 },
        { id: "base", name: "Base", asset: "USDC", minimum: "0.18", etaSeconds: 40 },
      ],
    });

    const res = await t.app.inject({ method: "GET", url: "/public/chains" });
    expect(res.statusCode).toBe(200);
    const chains = S.Chain.array().parse(res.json());
    expect(chains[0]).toEqual({ id: "bitcoin", name: "Bitcoin", asset: "BTC", minimum: "8.45", estimated_settlement: "about 13 minutes" });

    const m = await merchant(t.db);
    const inv = await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: m.auth,
      payload: { amount_expected: "49.00", currency: "USD", reference: "o1", chains: ["bitcoin", "base", "solana"] },
    });
    const addresses = Object.fromEntries(S.Invoice.parse(inv.json()).addresses.map((a) => [a.chain, a.minimum]));
    // Measured chains carry their minimum; an unmeasured one omits it.
    expect(addresses).toEqual({ bitcoin: "8.45", base: "0.18", solana: undefined });
  });
});
