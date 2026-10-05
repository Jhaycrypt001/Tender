import type { Redis } from "ioredis";
import type { Logger } from "../lib/logger.js";

/**
 * Display-currency rates: how many units of each currency one US dollar buys.
 *
 * ⚠️ PRESENTATION ONLY. Nothing here is used to price an invoice, settle a
 * payment or move money. The dashboard uses it to SHOW amounts that settle in
 * a dollar-pegged asset in the merchant's own currency; every real amount in
 * the database stays in the asset it actually moved in.
 *
 * The source is open.er-api.com: free, no key, one reference rate per currency
 * that updates about once a day. It is a reference rate, not a tradeable quote,
 * which is exactly what a number on a dashboard needs and nothing more. The
 * response says when it was published and the UI shows that date.
 *
 * Cached in Redis. A fresh copy is reused for an hour; if the source is down,
 * a stale copy is served for up to two days (an old rate beats a blank screen
 * here, and the `as_of` date says how old it is). With nothing cached and the
 * source down, there are no rates and the route says so (503): a rate is never
 * guessed.
 */

/** The currencies the dashboard offers, besides USD itself. Must match the frontend's list. */
export const FX_CODES = ["EUR", "GBP", "NGN", "JPY", "CAD", "AUD", "CHF", "INR", "BRL", "ZAR", "AED", "SGD"] as const;

export type FxSnapshot = {
  /** USD to one unit of each code, as a decimal string. */
  rates: Record<string, string>;
  /** When the source published these rates. */
  asOf: string;
  /** When we last fetched them. */
  fetchedAt: string;
};

const SOURCE_URL = "https://open.er-api.com/v6/latest/USD";
const CACHE_KEY = "tender:fx";
const FRESH_MS = 60 * 60_000;
const STALE_TTL_SECONDS = 48 * 60 * 60;
const FETCH_TIMEOUT_MS = 8_000;

export class FxService {
  constructor(
    private readonly redis: Pick<Redis, "get" | "set">,
    private readonly logger: Pick<Logger, "warn" | "error">,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Rates, from cache when fresh, else refreshed; stale if the source is down; null if there is nothing. */
  async get(): Promise<FxSnapshot | null> {
    const cached = await this.read();
    if (cached && this.now().getTime() - Date.parse(cached.fetchedAt) < FRESH_MS) return cached;

    const fresh = await this.fetchRates();
    if (fresh) {
      await this.redis.set(CACHE_KEY, JSON.stringify(fresh), "EX", STALE_TTL_SECONDS).catch(() => {});
      return fresh;
    }
    return cached;
  }

  private async read(): Promise<FxSnapshot | null> {
    try {
      const raw = await this.redis.get(CACHE_KEY);
      return raw ? (JSON.parse(raw) as FxSnapshot) : null;
    } catch {
      return null;
    }
  }

  private async fetchRates(): Promise<FxSnapshot | null> {
    try {
      const res = await this.fetchImpl(SOURCE_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: string; time_last_update_unix?: number; rates?: Record<string, unknown> };
      if (body.result !== "success" || !body.rates) throw new Error("unexpected response");

      const rates: Record<string, string> = {};
      for (const code of FX_CODES) {
        const value = body.rates[code];
        // A missing or nonsensical rate is dropped, never defaulted: one bad code costs only that code.
        if (typeof value === "number" && Number.isFinite(value) && value > 0) rates[code] = String(value);
      }
      if (Object.keys(rates).length === 0) throw new Error("no usable rates");

      const asOf = body.time_last_update_unix ? new Date(body.time_last_update_unix * 1000) : this.now();
      return { rates, asOf: asOf.toISOString(), fetchedAt: this.now().toISOString() };
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, "fetching FX rates failed");
      return null;
    }
  }
}
