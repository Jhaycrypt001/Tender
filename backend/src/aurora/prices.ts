import type { AuroraClient } from "./client.js";

/**
 * USD prices by Aurora asset id, from `GET /api/tokens`, cached briefly.
 * Used to value what a buyer sent at the moment it is detected.
 */
export class PriceBook {
  private cache: { at: number; prices: Map<string, number> } | undefined;

  constructor(
    private readonly aurora: Pick<AuroraClient, "tokens">,
    private readonly ttlMs = 60_000,
  ) {}

  /** USD price of one whole unit, or null if Aurora has none for this asset. */
  async usd(assetId: string | null): Promise<number | null> {
    if (!assetId) return null;
    const prices = await this.load();
    const price = prices.get(assetId);
    return typeof price === "number" && price > 0 ? price : null;
  }

  private async load(): Promise<Map<string, number>> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.prices;
    const tokens = await this.aurora.tokens();
    const prices = new Map<string, number>();
    for (const t of tokens) if (typeof t.price === "number") prices.set(t.assetId, t.price);
    this.cache = { at: Date.now(), prices };
    return prices;
  }
}
