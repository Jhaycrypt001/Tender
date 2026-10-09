import type { AuroraClient } from "../aurora/client.js";
import { assetKey } from "../aurora/prices.js";
import type { Logger } from "../lib/logger.js";

/**
 * Aurora asset id → ticker ("nep141:base-0x8335….omft.near" → "USDC"), so a payment can say
 * WHAT the buyer sent and not just how much: "0.00399" alone could be ETH or BTC.
 *
 * Serializers are synchronous, so the map is held here and refreshed in the background from
 * Aurora's token list. Until the first load (or if Aurora is down) a lookup is null and the
 * screen shows the bare amount, exactly as before.
 */
const symbols = new Map<string, string>();

export function assetSymbol(assetId: string | null | undefined): string | null {
  return assetId ? (symbols.get(assetKey(assetId)) ?? null) : null;
}

export async function refreshAssetSymbols(aurora: Pick<AuroraClient, "tokens">): Promise<void> {
  // Keyed without the "nep141:" prefix: deposits report ids without it (see assetKey).
  for (const t of await aurora.tokens()) symbols.set(assetKey(t.assetId), t.symbol);
}

/** Loads the map now and every 15 minutes. Returns a stop function. */
export function keepAssetSymbolsFresh(aurora: Pick<AuroraClient, "tokens">, logger: Pick<Logger, "warn">): () => void {
  const run = () => refreshAssetSymbols(aurora).catch((err: unknown) => logger.warn({ err: String(err) }, "could not load asset symbols"));
  void run();
  const timer = setInterval(run, 15 * 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
