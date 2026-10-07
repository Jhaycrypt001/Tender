import { request } from "./server";
import type { ApiResult, DepositAddress } from "./types";

/**
 * The standing deposit address. Merchant-authenticated — SERVER ONLY.
 *
 * One permanent address that takes any supported EVM chain and settles as USDC
 * on Monad, with no invoice behind each payment. Each deposit then shows up in
 * Activity as a payment with `source: "deposit"`.
 */

/** The address, or null if the merchant has not created one. Never creates. */
export function getDepositAddress(): Promise<ApiResult<DepositAddress | null>> {
  return request<DepositAddress | null>("/v1/deposit-address");
}

/** Creates it the first time; returns the same address every time after. */
export function createDepositAddress(): Promise<ApiResult<DepositAddress>> {
  return request<DepositAddress>("/v1/deposit-address", { method: "POST" });
}
