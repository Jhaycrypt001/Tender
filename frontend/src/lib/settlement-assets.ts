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
