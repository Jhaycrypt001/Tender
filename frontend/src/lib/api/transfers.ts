import { request } from "./server";
import type {
  ApiResult,
  PayoutChain,
  NearTransferInput,
  PrepareTransferInput,
  QuoteTransferInput,
  QuoteTransferResult,
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

/** The chains a payout or refund can be sent to, and what the recipient receives on each. */
export function listPayoutChains(): Promise<ApiResult<{ data: PayoutChain[] }>> {
  return request<{ data: PayoutChain[] }>("/v1/transfers/chains");
}

/** Would Aurora take this, and roughly what would arrive? Moves and creates nothing. */
export function quoteTransfer(input: QuoteTransferInput): Promise<ApiResult<QuoteTransferResult>> {
  return request<QuoteTransferResult>("/v1/transfers/quote", { method: "POST", body: input });
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

/* NEAR Intents, direct: a payout to a NEAR account. The same two-call flow, on its own endpoints. */

/** Would NEAR Intents take this, and roughly what would arrive? Moves and creates nothing. */
export function quoteNearTransfer(input: { to: string; amount: string }): Promise<ApiResult<QuoteTransferResult>> {
  return request<QuoteTransferResult>("/v1/transfers/near-direct/quote", { method: "POST", body: input });
}

/** Step 1. A deposit address from NEAR Intents, and the typed data to sign. Moves nothing. */
export function prepareNearTransfer(input: NearTransferInput): Promise<ApiResult<Transfer>> {
  return request<Transfer>("/v1/transfers/near-direct", { method: "POST", body: input });
}

/** Step 2. The wallet's signatures go back; the backend relays them. */
export function submitNearTransfer(id: string, input: SubmitTransferInput): Promise<ApiResult<Transfer>> {
  return request<Transfer>(`/v1/transfers/near-direct/${encodeURIComponent(id)}/submit`, { method: "POST", body: input });
}

export function getTransfer(id: string): Promise<ApiResult<Transfer>> {
  return request<Transfer>(`/v1/transfers/${encodeURIComponent(id)}`);
}

export function listTransfers(limit = 25): Promise<ApiResult<{ data: Transfer[] }>> {
  return request<{ data: Transfer[] }>("/v1/transfers", { query: { limit } });
}
