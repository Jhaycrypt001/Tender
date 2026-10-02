import type { z } from "zod";
import { deliveryStatus } from "./merchant.service.js";
import type * as S from "../../contract/schemas.js";
import type { ApiKey, Invoice, WebhookDelivery, InvoiceAddress, Merchant, Payment } from "../generated/prisma/client.js";
import { chainById } from "../aurora/chains.js";
import { Decimal } from "../lib/money.js";

/**
 * Database rows → wire shapes. The only place camelCase becomes snake_case,
 * and the only place a Decimal becomes a string.
 */

type Wire<T extends z.ZodType> = z.output<T>;
type InvoiceWithAddresses = Invoice & { addresses: InvoiceAddress[] };

/** At least two decimal places, never exponent notation: "49" → "49.00". */
export function amount(d: { toString(): string }): string {
  const value = new Decimal(d.toString());
  return value.toFixed(Math.max(2, value.decimalPlaces()));
}

/**
 * The status a reader should see. A PENDING invoice past its deadline is
 * EXPIRED even before the expiry worker has written that down, so no screen
 * ever shows a payable invoice that is not.
 */
export function effectiveStatus(invoice: Pick<Invoice, "status" | "expiresAt">, now = new Date()) {
  return invoice.status === "PENDING" && invoice.expiresAt <= now ? "EXPIRED" : invoice.status;
}

/**
 * One address entry per accepted chain. EVM chains share their family's
 * address, so they repeat it — the published contract stays one-per-chain.
 */
export function addressesFor(invoice: InvoiceWithAddresses, minimums?: Map<string, string>): Wire<typeof S.InvoiceAddress>[] {
  const byFamily = new Map(invoice.addresses.map((a) => [a.family, a.address]));
  return invoice.chains.flatMap((chain) => {
    const family = chainById(chain)?.family;
    const address = family ? byFamily.get(family) : undefined;
    if (!address) return [];
    // USD, measured by the worker (chains.service.ts). Omitted, never guessed, when unknown.
    const minimum = minimums?.get(chain);
    return [minimum ? { chain, address, minimum } : { chain, address }];
  });
}

export function toInvoice(invoice: InvoiceWithAddresses, minimums?: Map<string, string>): Wire<typeof S.Invoice> {
  return {
    id: invoice.id,
    token: invoice.token,
    status: effectiveStatus(invoice),
    amount_expected: amount(invoice.amountExpected),
    currency: invoice.currency,
    reference: invoice.reference,
    expires_at: invoice.expiresAt.toISOString(),
    created_at: invoice.createdAt.toISOString(),
    redirect_url: invoice.redirectUrl,
    metadata: (invoice.metadata as Record<string, unknown> | null) ?? null,
    addresses: addressesFor(invoice, minimums),
  };
}

/** What a stranger holding the checkout link may see. Built field by field, never spread. */
export function toPublicInvoice(
  invoice: InvoiceWithAddresses,
  merchant: Pick<Merchant, "name">,
  minimums?: Map<string, string>,
): Wire<typeof S.PublicInvoice> {
  return {
    token: invoice.token,
    status: effectiveStatus(invoice),
    amount_expected: amount(invoice.amountExpected),
    currency: invoice.currency,
    expires_at: invoice.expiresAt.toISOString(),
    merchant_name: merchant.name,
    addresses: addressesFor(invoice, minimums),
    redirect_url: invoice.redirectUrl,
  };
}

export function toPayment(p: Payment): Wire<typeof S.Payment> {
  return {
    id: p.id,
    invoice_id: p.invoiceId,
    tx_hash: p.auroraTxHash,
    from_chain: p.fromChain,
    amount_in: amount(p.amountIn),
    amount_settled: p.amountSettled ? amount(p.amountSettled) : null,
    status: p.status,
    first_seen_at: p.firstSeenAt.toISOString(),
    settled_at: p.settledAt?.toISOString() ?? null,
  };
}

export function toApiKeySummary(k: ApiKey): Wire<typeof S.ApiKeySummary> {
  return { id: k.id, prefix: k.prefix, created_at: k.createdAt.toISOString(), last_used_at: k.lastUsedAt?.toISOString() ?? null };
}

export function toWebhookDelivery(d: WebhookDelivery): Wire<typeof S.WebhookDelivery> {
  return {
    id: d.id,
    event: d.event,
    invoice_id: d.invoiceId,
    status: deliveryStatus(d),
    attempts: d.attempts,
    last_error: d.lastError,
    next_retry_at: d.nextRetryAt?.toISOString() ?? null,
    delivered_at: d.deliveredAt?.toISOString() ?? null,
    created_at: d.createdAt.toISOString(),
  };
}

export function toMerchant(m: Merchant): Wire<typeof S.Merchant> {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    settlement_address: m.settlementAddress,
    settlement_asset: m.settlementAsset,
    settlement_verified: m.settlementVerified,
    webhook_url: m.webhookUrl,
    fee_bps: m.feeBps,
    created_at: m.createdAt.toISOString(),
  };
}
