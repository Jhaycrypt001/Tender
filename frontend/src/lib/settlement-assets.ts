/**
 * The assets a merchant can be paid in, on Monad. Exactly what the backend
 * accepts (`SETTLEMENT_ASSETS` in `backend/src/services/merchant.service.ts`).
 * Anything else, such as plain "USDT" (the Monad token is USDT0), is refused
 * by the backend with a validation error.
 */
export const SETTLEMENT_ASSETS = [
  { value: "USDC", label: "USDC" },
  { value: "USDT0", label: "USDT0" },
  { value: "MON", label: "MON" },
] as const;

export const SETTLEMENT_ASSET_VALUES: readonly string[] = SETTLEMENT_ASSETS.map((a) => a.value);

/**
 * What the dashboard OFFERS: stablecoins only. Tender sends money out by having the wallet sign a
 * token transfer, which MON, Monad's own gas coin, cannot do, so a merchant who settled in MON could
 * not send anything. MON is not offered as a new choice. A merchant already on MON still sees it
 * (marked), so the screen never shows an asset they do not have, and they can switch away from it.
 */
export const STABLE_ASSETS = SETTLEMENT_ASSETS.filter((a) => a.value !== "MON");

export function offeredAssets(current: string) {
  return current === "MON"
    ? [...STABLE_ASSETS, { value: "MON", label: "MON (current, cannot be sent out)" }]
    : [...STABLE_ASSETS];
}
