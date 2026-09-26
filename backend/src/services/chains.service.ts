import type { Redis } from "ioredis";
import { CHAINS, SETTLEMENT_CHAIN, type ChainInfo } from "../aurora/chains.js";
import type { AuroraClient } from "../aurora/client.js";
import type { Token } from "../aurora/types.js";
import type { Logger } from "../lib/logger.js";
import { Decimal } from "../lib/money.js";

/**
 * Per-chain minimums and settlement estimates, MEASURED from Aurora.
 *
 * Aurora publishes no minimum deposit (BACKEND.md open question #2), and the
 * real floor moves with network fees: measured live on 2026-09-26 it ranged
 * from ~$0.01 (Arbitrum USDC) to ~$7 (Bitcoin). So the worker measures it by
 * binary-searching dry quotes for the smallest amount Aurora will route, adds
 * a safety margin, and caches the result in Redis for the API to serve.
 *
 * Minimums are in USD — the invoice currency — because a buyer may send more
 * than one asset on a chain; each chain's figure is the highest across the
 * assets measured on it.
 *
 * Nothing is ever defaulted: until a measurement exists, /public/chains says
 * so (503) rather than inventing a number.
 */

export type ChainQuote = {
  id: string;
  name: string;
  asset: string;
  /** USD, with the safety margin applied, rounded up to the cent. */
  minimum: string;
  /** Seconds, from Aurora's quote. */
  etaSeconds: number | null;
};

export type ChainCatalogue = { measuredAt: string; chains: ChainQuote[] };

const CACHE_KEY = "tender:chain-catalogue";
/** Stale data is worse than none for a minimum: expire it if the worker stops. */
const CACHE_TTL_SECONDS = 3 * 60 * 60;

/** Assets measured on each chain, beyond its display asset. */
const ALSO_MEASURE = ["USDC"];

/** Pause between dry quotes: this is background work and must not crowd out the poller. */
const QUOTE_SPACING_MS = 300;

type QuoteClient = Pick<AuroraClient, "dryQuote" | "tokens" | "mintAddress">;

/** The fixed `sender` for probe addresses: one per family, reused forever. */
const PROBE_SENDER = "tender-minimum-probe";

export async function measureCatalogue(
  aurora: QuoteClient,
  opts: { recipient: string; marginBps: number; logger: Logger; spacingMs?: number },
): Promise<ChainCatalogue> {
  const tokens = await aurora.tokens();
  const destination = tokens.find((t) => t.blockchain === SETTLEMENT_CHAIN && t.symbol === "USDC");
  if (!destination) throw new Error("USDC on Monad is not listed by Aurora");

  // A valid origin-chain address per family, to receive the (never-sent)
  // refund in each dry quote. Minting is idempotent: same inputs, same address.
  const refundTo = new Map<string, string>();
  for (const family of new Set(CHAINS.map((c) => c.family))) {
    const minted = await aurora.mintAddress({
      recipient: opts.recipient,
      sender: PROBE_SENDER,
      depositChain: family,
      destinationChain: SETTLEMENT_CHAIN,
      destinationAsset: destination.assetId,
    });
    refundTo.set(family, minted.depositAddress);
  }

  const chains: ChainQuote[] = [];
  for (const chain of CHAINS) {
    const assets = assetsFor(chain, tokens);
    const refund = refundTo.get(chain.family)!;
    let worstUsd: Decimal | null = null;
    let eta: number | null = null;

    for (const asset of assets) {
      const found = await smallestRoutable(
        aurora,
        asset,
        { destination: destination.assetId, recipient: opts.recipient, refundTo: refund },
        opts.spacingMs ?? QUOTE_SPACING_MS,
      );
      if (!found) {
        opts.logger.warn({ chain: chain.id, asset: asset.symbol }, "could not measure a minimum");
        continue;
      }
      if (!worstUsd || found.usd.gt(worstUsd)) worstUsd = found.usd;
      if (found.etaSeconds !== null) eta = Math.max(eta ?? 0, found.etaSeconds);
    }

    // A chain we could not measure is left out rather than given a guess.
    if (!worstUsd) continue;
    const withMargin = worstUsd.mul(new Decimal(1).add(new Decimal(opts.marginBps).div(10_000)));
    chains.push({
      id: chain.id,
      name: chain.name,
      asset: chain.asset,
      minimum: withMargin.toDecimalPlaces(2, Decimal.ROUND_UP).toFixed(2),
      etaSeconds: eta,
    });
  }
  return { measuredAt: new Date().toISOString(), chains };
}

function assetsFor(chain: ChainInfo, tokens: Token[]): Token[] {
  const symbols = [chain.asset, ...ALSO_MEASURE.filter((s) => s !== chain.asset)];
  return symbols
    .map((symbol) => tokens.find((t) => t.blockchain === chain.aurora && t.symbol === symbol && typeof t.price === "number" && t.price > 0))
    .filter((t): t is Token => !!t);
}

/**
 * Geometric binary search, in USD, for the smallest amount Aurora quotes,
 * between $0.01 and $10 (widening to $1,000 if needed). 8 steps give ~3%
 * precision, and the answer is always the upper bound — the side that was
 * seen to route — so it errs high, never low. The safety margin covers the rest.
 */
async function smallestRoutable(
  aurora: QuoteClient,
  asset: Token,
  route: { destination: string; recipient: string; refundTo: string },
  spacingMs: number,
) {
  const price = asset.price as number;
  const quoteAt = async (usd: number) => {
    await new Promise((r) => setTimeout(r, spacingMs));
    const units = new Decimal(usd).div(price).mul(new Decimal(10).pow(asset.decimals)).toDecimalPlaces(0, Decimal.ROUND_UP);
    return aurora.dryQuote({
      originAsset: asset.assetId,
      destinationAsset: route.destination,
      amount: units.toFixed(),
      recipient: route.recipient,
      refundTo: route.refundTo,
    });
  };

  let hi = 10;
  let top = await quoteAt(hi);
  while (!top && hi < 1000) {
    hi *= 10;
    top = await quoteAt(hi);
  }
  if (!top) return null;

  let lo = hi / 1_000;
  let eta = top.quote.timeEstimate ?? null;
  for (let i = 0; i < 8; i++) {
    const mid = Math.sqrt(lo * hi);
    const q = await quoteAt(mid);
    if (q) {
      hi = mid;
      eta = q.quote.timeEstimate ?? eta;
    } else lo = mid;
  }
  return { usd: new Decimal(hi), etaSeconds: eta };
}

export async function saveCatalogue(redis: Pick<Redis, "set">, catalogue: ChainCatalogue) {
  await redis.set(CACHE_KEY, JSON.stringify(catalogue), "EX", CACHE_TTL_SECONDS);
}

/**
 * Read side, for the API. Caches in memory briefly so a busy checkout page
 * does not hit Redis on every request.
 */
export class ChainCatalogueReader {
  private cached: { at: number; value: ChainCatalogue | null } | undefined;

  constructor(
    private readonly redis: Pick<Redis, "get">,
    private readonly ttlMs = 30_000,
  ) {}

  async get(): Promise<ChainCatalogue | null> {
    if (this.cached && Date.now() - this.cached.at < this.ttlMs) return this.cached.value;
    const raw = await this.redis.get(CACHE_KEY);
    const value = raw ? (JSON.parse(raw) as ChainCatalogue) : null;
    this.cached = { at: Date.now(), value };
    return value;
  }

  /** chain id → USD minimum, for decorating invoice addresses. */
  async minimums(): Promise<Map<string, string>> {
    const catalogue = await this.get();
    return new Map((catalogue?.chains ?? []).map((c) => [c.id, c.minimum]));
  }
}

/** "about 2 minutes", "about 14 minutes", "about an hour". */
export function describeEta(seconds: number | null): string {
  if (seconds === null) return "a few minutes";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes === 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours === 1 ? "about an hour" : `about ${hours} hours`;
}
