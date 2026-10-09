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
    const price = prices.get(assetKey(assetId));
    return typeof price === "number" && price > 0 ? price : null;
  }

  private async load(): Promise<Map<string, number>> {
    if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.prices;
    const tokens = await this.aurora.tokens();
    const prices = new Map<string, number>();
    for (const t of tokens) if (typeof t.price === "number") prices.set(assetKey(t.assetId), t.price);
    this.cache = { at: Date.now(), prices };
    return prices;
  }
}

/**
 * One key for an asset however Aurora spells it. ⚠️ The token list says
 * "nep141:base-0x8335….omft.near" but a deposit's `asset_id` says
 * "base-0x8335….omft.near", with no standard prefix. Looking one up in the other
 * found nothing, so every payment was stored with no USD value and judged as $0:
 * invoices paid in full were marked UNDERPAID.
 */
export function assetKey(assetId: string): string {
  return assetId.replace(/^nep\d+:/i, "").toLowerCase();
}
