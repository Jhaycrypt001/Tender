import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { MintInput } from "../src/aurora/client.js";
import { PriceBook } from "../src/aurora/prices.js";
import type { Deposit, DepositListType } from "../src/aurora/types.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { createLogger } from "../src/lib/logger.js";
import { createMerchant } from "../src/services/merchant.service.js";
import { ChainCatalogueReader } from "../src/services/chains.service.js";
import { InvoiceStream } from "../src/services/stream.js";
import { Poller, type PollerConfig } from "../src/workers/poller.js";
import { TEST_DATABASE_URL } from "./global-setup.js";

export const SETTLEMENT = "0x4CAD8fac813f7436Bac414D2C9426363567EFE7f";
// Database 1, never 0: tests must not touch the dev cache (the chain catalogue lives there).
export const REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/1";

/** `tp_` + 32 random bytes as base64url: what the dashboard server is given. */
export const PLATFORM_KEY = "tp_Zx3kQ9vLmN2pR7sT1uW5yA8cE4gH6jK0bD-fI_oXqUz";

/** Asset ids and prices the fake price feed knows. */
export const ASSETS = {
  USDC_BASE: { id: "nep141:base-usdc.test", decimals: 6, price: 1 },
  SOL: { id: "nep141:sol.test", decimals: 9, price: 150 },
  USDC_MONAD: { id: "nep245:monad-usdc.test", decimals: 6, price: 1 },
  UNPRICED: { id: "nep141:mystery.test", decimals: 18, price: null },
} as const;

type Ledger = Record<DepositListType, Deposit[]>;

/**
 * A stand-in for Aurora. Addresses are deterministic and opaque — derived by
 * hash, like real ones, so no input (such as the invoice id) can be read back
 * out of them. Deposits are whatever a test puts in the ledger.
 *
 * Mocking Aurora in tests is correct; mocking data in the product is not (§11).
 */
export function fakeAurora() {
  const ledger = new Map<string, Ledger>();
  const failing = new Set<string>();
  const entry = (address: string) => {
    let l = ledger.get(address);
    if (!l) ledger.set(address, (l = { received: [], success: [], failed: [] }));
    return l;
  };

  return {
    mintAddress: vi.fn(async (input: MintInput) => ({
      depositAddress: `${input.depositChain}_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32)}`,
      alreadyExists: false,
    })),
    submitDeposit: vi.fn(async () => {}),
    deposits: vi.fn(async (address: string, type: DepositListType) => {
      if (failing.has(address)) {
        const { AuroraError } = await import("../src/aurora/client.js");
        throw new AuroraError("upstream", "down", 503);
      }
      return [...entry(address)[type]];
    }),
    tokens: vi.fn(async () =>
      Object.values(ASSETS).map((a) => ({ assetId: a.id, symbol: a.id, blockchain: "test", decimals: a.decimals, price: a.price })),
    ),
    /** Test controls. */
    push(address: string, type: DepositListType, deposit: Deposit) {
      entry(address)[type].push(deposit);
    },
    fail(address: string, on = true) {
      if (on) failing.add(address);
      else failing.delete(address);
    },
  };
}

export type FakeAurora = ReturnType<typeof fakeAurora>;

export type TestContext = {
  app: FastifyInstance;
  db: Db;
  aurora: FakeAurora;
  redis: Redis;
  subscriber: Redis;
};

export async function setupApp(): Promise<TestContext> {
  const config = loadConfig({
    NODE_ENV: "test",
    LOG_LEVEL: "fatal",
    DATABASE_URL: TEST_DATABASE_URL,
    AURORA_API_KEY: "test",
    TENDER_PLATFORM_KEY: PLATFORM_KEY,
  });
  const db = createDb(TEST_DATABASE_URL);
  const aurora = fakeAurora();
  const redis = new Redis(REDIS_URL);
  const subscriber = new Redis(REDIS_URL);
  // No read cache in tests, so a catalogue written by a test is seen at once.
  const catalogue = new ChainCatalogueReader(redis, 0);
  const app = await buildApp({ config, db, redis, aurora, stream: new InvoiceStream(subscriber), catalogue });
  return { app, db, aurora, redis, subscriber };
}

export async function teardown(t: TestContext) {
  await t.app.close();
  await Promise.allSettled([t.db.$disconnect(), t.redis.quit(), t.subscriber.quit()]);
}

export async function resetDb(db: Db) {
  await db.$executeRawUnsafe(
    `TRUNCATE "RecoveryTask", "Payment", "InvoiceEvent", "InvoiceAddress", "Invoice", "WebhookDelivery", "PaymentLink", "ApiKey", "Merchant" CASCADE`,
  );
}

export async function merchant(db: Db, overrides: { verified?: boolean; name?: string; email?: string } = {}) {
  const { merchant, apiKey } = await createMerchant(db, {
    name: overrides.name ?? "Acme Store",
    email: overrides.email ?? `ops-${Math.random().toString(36).slice(2)}@acme.test`,
    settlementAddress: SETTLEMENT,
    settlementVerified: overrides.verified ?? true,
  });
  return { merchant, auth: { authorization: `Bearer ${apiKey}` } };
}

export const POLLER_CONFIG: PollerConfig = {
  intervalMs: 5000,
  toleranceBps: 100,
  graceMinutes: 15,
  lateWindowHours: 24,
  concurrency: 4,
  batchSize: 100,
};

/** A poller over the test database with a controllable clock. */
export function makePoller(t: TestContext, clock: { now: Date } = { now: new Date() }) {
  const publish = vi.fn(async () => 1);
  const poller = new Poller({
    db: t.db,
    aurora: t.aurora,
    prices: new PriceBook(t.aurora),
    redis: { publish } as unknown as Pick<Redis, "publish">,
    logger: createLogger("fatal", false),
    config: POLLER_CONFIG,
    now: () => clock.now,
  });
  return { poller, publish, clock };
}

let seq = 0;
/** One Aurora deposit-list entry. */
export function deposit(
  address: string,
  opts: { asset: (typeof ASSETS)[keyof typeof ASSETS]; amount: string; at?: Date; tx?: string; fromChain?: string },
): Deposit {
  return {
    tx_hash: opts.tx ?? `tx_${++seq}_${Math.random().toString(36).slice(2, 8)}`,
    fromChain: opts.fromChain ?? "base",
    destinationChain: "monad",
    asset_id: opts.asset.id,
    decimals: opts.asset.decimals,
    amount: opts.amount,
    from: "buyer",
    created_at: (opts.at ?? new Date()).toISOString(),
    intents_account: "intents.test",
    deposit_address: address,
    recipient: SETTLEMENT,
  };
}
