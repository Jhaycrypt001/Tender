import { publicBase, publicRequest } from "./client";
import type { ApiResult, Chain, PublicInvoice } from "./types";

/**
 * The public, unauthenticated API — everything the buyer checkout calls.
 *
 * Unlike the rest of `src/lib/api/`, these are safe from the browser: they
 * carry no key and return no merchant data. The buyer never signs in, never
 * connects a wallet, and never identifies themselves.
 */

/**
 * The invoice behind a checkout token.
 *
 * Takes the `chk_` token, never the `inv_` id: the id is enumerable and
 * merchant-private, so it must not appear in a link a stranger can hold.
 */
export function getPublicInvoice(
  token: string,
): Promise<ApiResult<PublicInvoice>> {
  return publicRequest<PublicInvoice>(
    `/public/invoices/${encodeURIComponent(token)}`,
  );
}

/**
 * Supported chains, with per-chain minimums and settlement estimates.
 *
 * The minimum matters more than it looks: a deposit below it is refunded
 * automatically by the network, so a buyer who was not shown the number first
 * experiences a silent failure. Show it before they send.
 *
 * Cached for a minute — this list changes rarely, and the buyer page should
 * not wait on a fresh fetch to render its chain chips.
 */
export function getChains(): Promise<ApiResult<Chain[]>> {
  return publicRequest<Chain[]>("/public/chains", { revalidate: 60 });
}

/**
 * Optional accelerator: the buyer pastes the hash of the transfer they just
 * sent, and detection skips ahead instead of waiting for the next poll.
 * A failure here is harmless — the payment is found on the next cycle anyway,
 * so the UI should not present it as an error.
 */
export function submitTx(
  token: string,
  txHash: string,
): Promise<ApiResult<{ accepted: boolean }>> {
  return publicRequest<{ accepted: boolean }>(
    `/public/invoices/${encodeURIComponent(token)}/submit-tx`,
    { method: "POST", body: { tx_hash: txHash } },
  );
}

/**
 * Open a reusable payment link (`pl_`): mints a fresh invoice for this buyer
 * and returns its `chk_` checkout token.
 *
 * ⚠️ Call from the browser, never the server. The backend allows 10 opens a
 * minute per IP; from our server every buyer would share one IP.
 *
 * A fixed-amount link ignores `amount`. An open-amount link called without one
 * fails with a validation error on `fields.amount` — that is the signal to ask
 * the buyer for an amount, not a failure.
 */
export function openPaymentLink(
  token: string,
  amount?: string,
): Promise<ApiResult<{ token: string }>> {
  return publicRequest<{ token: string }>(
    `/public/links/${encodeURIComponent(token)}`,
    { method: "POST", body: amount ? { amount } : {} },
  );
}

/**
 * URL of the server-sent events stream for one invoice.
 *
 * Returned as a string rather than an EventSource so the caller owns the
 * lifecycle: an EventSource created here would outlive the component that
 * wanted it and leak a connection per render.
 *
 * Empty string when the API is not configured — the caller should check, and
 * fall back to polling `getPublicInvoice`.
 */
export function invoiceEventsUrl(token: string): string {
  const base = publicBase();
  if (!base) return "";
  return `${base}/public/invoices/${encodeURIComponent(token)}/events`;
}
