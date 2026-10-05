import { request } from "./server";
import type {
  ApiResult,
  PrepareTransferInput,
  SubmitTransferInput,
  Transfer,
  WalletBalance,
} from "./types";

/**
 * Money sent OUT of the merchant's own wallet: payouts, refunds and splits.
 * Merchant-authenticated, so SERVER ONLY.
 *
 * The flow is two calls with a signature in between, and the signature never
 * touches this server's keys: the merchant's own wallet makes it, in the
 * browser. `prepareTransfer` returns what to sign; `submitTransfer` hands the
 * signatures back and the backend relays them and pays the network fee.
 */

/** Whether the merchant can send right now, and what their wallet holds. */
export function getWalletBalance(): Promise<ApiResult<WalletBalance>> {
  return request<WalletBalance>("/v1/transfers/wallet");
}

/** Step 1. Validates and returns the typed data to sign. Moves nothing. */
export function prepareTransfer(input: PrepareTransferInput): Promise<ApiResult<Transfer>> {
  return request<Transfer>("/v1/transfers", { method: "POST", body: input });
}

/** Step 2. The wallet's signatures go back; the backend relays them. */
export function submitTransfer(
  id: string,
  input: SubmitTransferInput,
): Promise<ApiResult<Transfer>> {
  return request<Transfer>(`/v1/transfers/${encodeURIComponent(id)}/submit`, {
    method: "POST",
    body: input,
  });
}

export function getTransfer(id: string): Promise<ApiResult<Transfer>> {
  return request<Transfer>(`/v1/transfers/${encodeURIComponent(id)}`);
}

export function listTransfers(limit = 25): Promise<ApiResult<{ data: Transfer[] }>> {
  return request<{ data: Transfer[] }>("/v1/transfers", { query: { limit } });
}
