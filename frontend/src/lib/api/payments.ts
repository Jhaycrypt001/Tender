import { request } from "./server";
import type {
  ApiResult,
  ListPaymentsQuery,
  Paginated,
  Payment,
  PaymentDetail,
} from "./types";

/**
 * Payment endpoints, including the recovery actions.
 * Merchant-authenticated — SERVER ONLY.
 */

/** Payments across every invoice. Backs the Activity screen. */
export function listPayments(
  query: ListPaymentsQuery = {},
): Promise<ApiResult<Paginated<Payment>>> {
  return request<Paginated<Payment>>("/v1/payments", { query });
}

/** One payment, with its state history and any open recovery task. */
export function getPayment(id: string): Promise<ApiResult<PaymentDetail>> {
  return request<PaymentDetail>(`/v1/payments/${encodeURIComponent(id)}`);
}

/**
 * Refund a settled payment back to its sender.
 *
 * This is the merchant choosing to give money back. It is NOT the automatic
 * refund of an under-minimum deposit, which the network performs on its own
 * with no call from us.
 */
export function refundPayment(id: string): Promise<ApiResult<PaymentDetail>> {
  return request<PaymentDetail>(`/v1/payments/${encodeURIComponent(id)}/refund`, {
    method: "POST",
  });
}

/* --------------------------------------------------------------------------
   Recovery — the two actions behind NEEDS_RECOVERY.

   Worth stating plainly, because it is the distinction most integrations miss:
   a deposit that fails BEFORE it lands is refunded automatically and needs no
   UI at all. A deposit that lands and then fails on the way onward is NOT
   refunded, and sits there until a human does something. These two calls are
   that something, and they are the only route out of the state.
   -------------------------------------------------------------------------- */

/** Re-attempt the onward settlement for a payment stuck in NEEDS_RECOVERY. */
export function retryPayment(id: string): Promise<ApiResult<PaymentDetail>> {
  return request<PaymentDetail>(`/v1/payments/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
}

/**
 * Give up on settling and withdraw the stranded funds instead.
 *
 * `address` defaults to the merchant's settlement address when omitted, so the
 * common case needs no input — but it stays overridable, because the reason
 * settlement failed may well be the settlement address itself.
 */
export function withdrawPayment(
  id: string,
  address?: string,
): Promise<ApiResult<PaymentDetail>> {
  return request<PaymentDetail>(`/v1/payments/${encodeURIComponent(id)}/withdraw`, {
    method: "POST",
    body: address ? { address } : undefined,
  });
}
