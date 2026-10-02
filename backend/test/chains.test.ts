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

describe("the 30-chain registry", () => {
  it("has exactly 30 unique chains, each with an Aurora code and an asset", async () => {
    const { CHAINS } = await import("../src/aurora/chains.js");
    expect(CHAINS).toHaveLength(30);
    expect(new Set(CHAINS.map((c) => c.id)).size).toBe(30);
    expect(new Set(CHAINS.map((c) => c.aurora)).size).toBe(30);
    for (const c of CHAINS) {
      expect(c.aurora, c.id).toMatch(/^[a-z]+$/);
      expect(c.asset, c.id).toMatch(/^[A-Za-z0-9]+$/);
      // Stellar needs a memo, which the contract cannot carry.
      expect(c.id).not.toBe("stellar");
    }
  });

  it("matches the frontend's label table id for id, so no chain renders as 'Bsc' or 'Xrp'", async () => {
    const { readFileSync } = await import("node:fs");
    const { CHAINS } = await import("../src/aurora/chains.js");
    const src = readFileSync(new URL("../../frontend/src/lib/chains.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf("CHAIN_LABEL"), src.indexOf("};", src.indexOf("CHAIN_LABEL")));
    const frontend = [...block.matchAll(/^\s+([a-z]+):\s*"([^"]+)",/gm)].map((m) => [m[1], m[2]] as const);
    expect(frontend.map(([id]) => id).sort()).toEqual(CHAINS.map((c) => c.id).sort());
    for (const [id, label] of frontend) expect(CHAINS.find((c) => c.id === id)?.name, id).toBe(label);
  });

  it("gives every EVM chain the single shared 'evm' family, and every other chain its own Aurora code", async () => {
    const { CHAINS } = await import("../src/aurora/chains.js");
    const evm = ["ethereum", "base", "arbitrum", "monad", "optimism", "polygon", "bnb", "avalanche", "gnosis", "scroll", "berachain", "plasma", "xlayer", "adi"];
    for (const c of CHAINS) expect(c.family, c.id).toBe(evm.includes(c.id) ? "evm" : c.aurora);
  });

  it("defaults to 4 mint calls per invoice, not 17: every EVM chain plus Bitcoin, Solana and Tron", async () => {
    const { DEFAULT_CHAINS, familiesFor } = await import("../src/aurora/chains.js");
    expect(familiesFor(DEFAULT_CHAINS).sort()).toEqual(["btc", "evm", "sol", "tron"]);
    expect(DEFAULT_CHAINS).toHaveLength(17);
    for (const optIn of ["xrp", "ton", "cardano", "near", "aleo"]) expect(DEFAULT_CHAINS).not.toContain(optIn);
  });

  it("mints one address per family for an opt-in chain, and lets a merchant pick any of the 30", async () => {
    const t = await setupApp();
    try {
      const m = await merchant(t.db);
      const res = await t.app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: m.auth,
        payload: { amount_expected: "5.00", currency: "USD", reference: "xrp-1", chains: ["xrp", "ton", "polygon", "optimism"] },
      });
      expect(res.statusCode).toBe(201);
      const families = t.aurora.mintAddress.mock.calls.map(([i]) => i.depositChain).sort();
      // polygon + optimism share one EVM address; xrp and ton are their own.
      expect(families).toEqual(["evm", "ton", "xrp"]);
      expect(res.json().addresses.map((a: { chain: string }) => a.chain).sort()).toEqual(["optimism", "polygon", "ton", "xrp"]);
    } finally {
      await resetDb(t.db);
      await teardown(t);
    }
  });

  it("refuses a chain outside the 30, such as Stellar", async () => {
    const t = await setupApp();
    try {
      const m = await merchant(t.db);
      const res = await t.app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: m.auth,
        payload: { amount_expected: "5.00", currency: "USD", reference: "stellar-1", chains: ["stellar"] },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await resetDb(t.db);
      await teardown(t);
    }
  });
});

describe("measureCatalogue under failure", () => {
  const opts = (extra: object = {}) => ({
    recipient: "0x1",
    marginBps: 2000,
    logger: createLogger("fatal", false),
    spacingMs: 0,
    retryDelayMs: 0,
    ...extra,
  });

  it("retries a chain after a network blip and still measures it", async () => {
    const { AuroraError } = await import("../src/aurora/client.js");
    const aurora = quoteAurora();
    const real = aurora.dryQuote.getMockImplementation()!;
    let failed = false;
    aurora.dryQuote.mockImplementation(async (input) => {
      if (!failed && input.originAsset === "base-usdc") {
        failed = true;
        throw new AuroraError("network", "fetch failed");
      }
      return real(input);
    });
    const catalogue = await measureCatalogue(aurora, opts());
    expect(failed).toBe(true);
    expect(catalogue.chains.map((c) => c.id)).toContain("base");
    expect(catalogue.chains.map((c) => c.id)).toContain("bitcoin");
  });

  it("drops only the chain that keeps failing; every other chain is still measured", async () => {
    const { AuroraError } = await import("../src/aurora/client.js");
    const aurora = quoteAurora();
    const real = aurora.dryQuote.getMockImplementation()!;
    aurora.dryQuote.mockImplementation(async (input) => {
      if (input.originAsset === "sol") throw new AuroraError("upstream", "502", 502);
      return real(input);
    });
    const catalogue = await measureCatalogue(aurora, opts());
    const ids = catalogue.chains.map((c) => c.id);
    expect(ids).not.toContain("solana");
    expect(ids).toEqual(expect.arrayContaining(["bitcoin", "base"]));
  });

  it("does not retry a refusal that is not retryable, and still surfaces real bugs", async () => {
    const { AuroraError } = await import("../src/aurora/client.js");
    const aurora = quoteAurora();
    const real = aurora.dryQuote.getMockImplementation()!;
    let calls = 0;
    aurora.dryQuote.mockImplementation(async (input) => {
      if (input.originAsset === "btc") {
        calls++;
        throw new AuroraError("not_found", "no such route", 404);
      }
      return real(input);
    });
    const catalogue = await measureCatalogue(aurora, opts());
    expect(calls).toBe(1);
    expect(catalogue.chains.map((c) => c.id)).not.toContain("bitcoin");

    aurora.dryQuote.mockImplementation(async () => {
      throw new TypeError("a real bug");
    });
    await expect(measureCatalogue(aurora, opts())).rejects.toThrow("a real bug");
  });

  it("reports progress after each chain, growing, so a cold start can publish early", async () => {
    const aurora = quoteAurora();
    const sizes: number[] = [];
    const catalogue = await measureCatalogue(aurora, opts({ onProgress: (p: { chains: unknown[] }) => void sizes.push(p.chains.length) }));
    expect(sizes).toEqual(Array.from({ length: catalogue.chains.length }, (_, i) => i + 1));
    expect(sizes.length).toBeGreaterThan(1);
  });

  it("survives a progress callback that throws", async () => {
    const aurora = quoteAurora();
    const catalogue = await measureCatalogue(aurora, opts({ onProgress: () => Promise.reject(new Error("redis down")) }));
    expect(catalogue.chains.length).toBeGreaterThan(1);
  });

  it("measures only the chains asked for", async () => {
    const aurora = quoteAurora();
    const catalogue = await measureCatalogue(aurora, opts({ only: ["base"] }));
    expect(catalogue.chains.map((c) => c.id)).toEqual(["base"]);
  });
});
