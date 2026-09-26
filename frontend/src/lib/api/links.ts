import { request } from "./client";
import type { ApiResult, CreateLinkInput, Paginated, PaymentLink } from "./types";

/**
 * Reusable payment links. Merchant-authenticated — SERVER ONLY.
 *
 * A link differs from an invoice in lifetime, not in kind: an invoice is one
 * buyer paying one amount once, while a link is shared and produces a fresh
 * invoice for each buyer who opens it. That is why a link has `uses` and no
 * status of its own.
 */

export function listLinks(
  query: { cursor?: string; limit?: number } = {},
): Promise<ApiResult<Paginated<PaymentLink>>> {
  return request<Paginated<PaymentLink>>("/v1/links", { query });
}

/** Create a link. A null `amount` lets the buyer choose what to pay. */
export function createLink(
  input: CreateLinkInput,
): Promise<ApiResult<PaymentLink>> {
  return request<PaymentLink>("/v1/links", { method: "POST", body: input });
}
