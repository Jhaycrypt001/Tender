import { request } from "./client";
import type { Amount, ApiResult, EarnPosition } from "./types";

/**
 * Earn: settled revenue put to work on Monad, via Intents Connect.
 * Merchant-authenticated — SERVER ONLY.
 *
 * What makes this more than a second transfer is that the deposit rides along
 * with the settlement itself — one flow, not "money lands, then the merchant
 * moves it". The merchant never signs a second time.
 */

/** Open positions, with APY and accrued earnings. */
export function getPositions(): Promise<ApiResult<EarnPosition[]>> {
  return request<EarnPosition[]>("/v1/earn/positions");
}

/**
 * Deposit into a protocol.
 *
 * `amount` is a string for the same reason every amount here is: an 18-decimal
 * value does not round-trip through a JSON float.
 */
export function deposit(
  protocol: string,
  asset: string,
  amount: Amount,
): Promise<ApiResult<EarnPosition>> {
  return request<EarnPosition>("/v1/earn/deposit", {
    method: "POST",
    body: { protocol, asset, amount },
  });
}
