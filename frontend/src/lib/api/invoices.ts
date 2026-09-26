import { request } from "./client";
import type {
  ApiResult,
  CreateInvoiceInput,
  Invoice,
  ListInvoicesQuery,
  Paginated,
} from "./types";

/**
 * Invoice endpoints. Merchant-authenticated, so SERVER ONLY — see the security
 * note in `client.ts`.
 */

/**
 * Create an invoice. The backend mints one deposit address per accepted chain
 * and returns them all, plus the public `token` for the checkout URL.
 *
 * ⚠️ Always pass `idempotencyKey`. A merchant clicking Create twice, or a
 * retried request after a timeout, must not produce two invoices for one
 * order. The backend keys on it and returns the original. Using the order
 * reference is the natural choice — it is already unique per merchant.
 */
export function createInvoice(
  input: CreateInvoiceInput,
  idempotencyKey?: string,
): Promise<ApiResult<Invoice>> {
  return request<Invoice>("/v1/invoices", {
    method: "POST",
    body: input,
    idempotencyKey: idempotencyKey ?? input.reference,
  });
}

/** One invoice, with its addresses and any payments against it. */
export function getInvoice(id: string): Promise<ApiResult<Invoice>> {
  return request<Invoice>(`/v1/invoices/${encodeURIComponent(id)}`);
}

/** Invoices for this merchant, newest first, filterable and paginated. */
export function listInvoices(
  query: ListInvoicesQuery = {},
): Promise<ApiResult<Paginated<Invoice>>> {
  return request<Paginated<Invoice>>("/v1/invoices", { query });
}

/**
 * Cancel an invoice that has not been paid.
 *
 * Note this closes the invoice, not the address: Aurora's deposit addresses
 * are permanent and keep working. Cancellation is Tender's own bookkeeping
 * layered on top, which is why money can still arrive afterwards and has to
 * be handled rather than assumed impossible.
 */
export function cancelInvoice(id: string): Promise<ApiResult<Invoice>> {
  return request<Invoice>(`/v1/invoices/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}
