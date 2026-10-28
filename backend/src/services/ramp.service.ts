import type { Redis } from "ioredis";
import type { Logger } from "../lib/logger.js";
import { TOKENS, tokenFor } from "../lib/tokens.js";

/**
 * Which off-ramp corridors are real, read from Ramp Network.
 *
 * A corridor is LIVE only when Ramp itself says THE MERCHANT'S settlement asset (USDC or USDT0 on
 * Monad, at our exact contract address) can be sold for that currency right now. The question goes to
 * Ramp's public `offramp/assets` endpoint, which needs no key, so this works before the production key
 * arrives.
 *
 * ⚠️ Every failure is NOT_OPEN, never LIVE. A corridor wrongly marked LIVE sends a merchant into a payout
 * that will reject them; one wrongly marked NOT_OPEN only makes them ask us. So a timeout, a non-200, an
 * unexpected shape, an asset list without the merchant's token, or a settlement asset we cannot match to
 * a Monad token all read as NOT_OPEN, and a stale LIVE is never served past its hour.
 *
 * Ramp's `maxPurchaseAmount` is PER SALE, not per day, so it is deliberately not surfaced as `daily_cap`.
 * Nothing here sets a cap.
 */

/** The currencies we list. NGN stays in so Nigeria appears on the screen marked honestly. */
export const RAMP_CORRIDORS = [
  { country: "United States", currency: "USD" },
  { country: "Eurozone", currency: "EUR" },
  { country: "United Kingdom", currency: "GBP" },
  { country: "Nigeria", currency: "NGN" },
] as const;

export type CorridorStatus = "LIVE" | "NOT_OPEN";

export type Corridor = {
  country: string;
  currency: string;
  status: CorridorStatus;
};

/** Per currency: which of our tokens Ramp will buy. Merchant-independent, so one cached answer serves everyone. */
type Cached = { sellable: string[]; fetchedAt: string };

const SOURCE_URL = "https://api.rampnetwork.com/api/host-api/v3/offramp/assets";
const cacheKey = (currency: string) => `tender:ramp:offramp:v2:${currency}`;
/** A definite answer from Ramp (supported, or "currency not supported") is reused for an hour. */
const FRESH_MS = 60 * 60_000;
/** A failed lookup is remembered briefly, so a Ramp outage is not hit (or logged) on every page load. */
const FAILED_MS = 60_000;
const FETCH_TIMEOUT_MS = 8_000;

export class RampService {
  constructor(
    private readonly redis: Pick<Redis, "get" | "set">,
    private readonly logger: Pick<Logger, "warn" | "error">,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Corridors for a merchant who settles in `settlementAsset` (a symbol such as "USDC"; defaults to USDC). */
  async corridors(settlementAsset: string | null | undefined): Promise<Corridor[]> {
    const token = tokenFor(settlementAsset ?? "USDC");
    const sellable = await Promise.all(RAMP_CORRIDORS.map((c) => this.sellableFor(c.currency)));
    return RAMP_CORRIDORS.map((c, i) => ({
      country: c.country,
      currency: c.currency,
      status: token && sellable[i]!.includes(token.symbol) ? "LIVE" : "NOT_OPEN",
    }));
  }

  private async sellableFor(currency: string): Promise<string[]> {
    const cached = await this.read(currency);
    if (cached) return cached.sellable;

    const { sellable, definite } = await this.lookup(currency);
    // Only a failure is cached short. Whatever Ramp answered clearly is cached for the full hour.
    const entry: Cached = { sellable, fetchedAt: this.now().toISOString() };
    await this.redis.set(cacheKey(currency), JSON.stringify(entry), "PX", definite ? FRESH_MS : FAILED_MS).catch(() => {});
    return sellable;
  }

  private async read(currency: string): Promise<Cached | null> {
    try {
      const raw = await this.redis.get(cacheKey(currency));
      if (!raw) return null;
      const entry = JSON.parse(raw) as Partial<Cached>;
      // A malformed entry is treated as no entry, so it is re-fetched rather than trusted.
      if (!Array.isArray(entry.sellable) || !entry.sellable.every((s) => typeof s === "string") || typeof entry.fetchedAt !== "string") return null;
      return entry as Cached;
    } catch {
      return null;
    }
  }

  private async lookup(currency: string): Promise<{ sellable: string[]; definite: boolean }> {
    try {
      const res = await this.fetchImpl(`${SOURCE_URL}?currencyCode=${encodeURIComponent(currency)}`, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
        // Ramp's own, explicit "we do not pay out this currency": a real answer, not an error.
        if (typeof body?.code === "string" && body.code.endsWith("FIAT_CURRENCY_NOT_SUPPORTED")) {
          return { sellable: [], definite: true };
        }
        throw new Error("HTTP 400");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = (await res.json()) as { assets?: unknown };
      if (!Array.isArray(body.assets)) throw new Error("unexpected response");

      const sellable = Object.values(TOKENS)
        .filter((token) =>
          (body.assets as unknown[]).some((a) => {
            const asset = a as { chain?: unknown; symbol?: unknown; address?: unknown; enabled?: unknown } | null;
            return (
              typeof asset === "object" &&
              asset !== null &&
              asset.chain === "MONAD" &&
              asset.symbol === token.symbol &&
              asset.enabled === true &&
              // The address must be OUR token: a different contract on Monad is not the asset merchants hold.
              typeof asset.address === "string" &&
              asset.address.toLowerCase() === token.address.toLowerCase()
            );
          }),
        )
        .map((token) => token.symbol);
      return { sellable, definite: true };
    } catch (err) {
      this.logger.warn({ currency, err: (err as Error).message }, "checking Ramp off-ramp corridor failed");
      return { sellable: [], definite: false };
    }
  }
}
