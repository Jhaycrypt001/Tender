import type { Redis } from "ioredis";
import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Invoice, InvoiceStatus, Payment } from "../generated/prisma/client.js";
import { eventId } from "../lib/ids.js";
import { amount } from "./serialize.js";

/**
 * Status changes fan out two ways:
 *   - to the buyer's checkout page, live, over SSE (via Redis pub/sub, so the
 *     poller process and the API process can be separate);
 *   - to the merchant's server, as a signed webhook (via the WebhookDelivery
 *     outbox, written in the same transaction as the change itself).
 */

export type InvoiceEventWire = z.output<typeof S.InvoiceEvent>;

export const channelFor = (token: string) => `invoice-events:${token}`;

export async function publishInvoiceEvent(redis: Redis, token: string, event: InvoiceEventWire) {
  await redis.publish(channelFor(token), JSON.stringify(event));
}

/** The six events published at /docs. PENDING and CANCELLED do not notify. */
const WEBHOOK_EVENTS: Partial<Record<InvoiceStatus, string>> = {
  DETECTED: "invoice.detected",
  SETTLED: "invoice.settled",
  OVERPAID: "invoice.overpaid",
  UNDERPAID: "invoice.underpaid",
  EXPIRED: "invoice.expired",
  NEEDS_RECOVERY: "invoice.needs_recovery",
};

export function webhookEventFor(status: InvoiceStatus): string | undefined {
  return WEBHOOK_EVENTS[status];
}

/** The payload shape published at /docs. */
export function webhookPayload(
  event: string,
  invoice: Pick<Invoice, "id" | "reference" | "amountExpected">,
  status: InvoiceStatus,
  payment: Pick<Payment, "fromChain" | "amountSettled" | "settledAt"> | null,
  at: Date,
) {
  return {
    id: eventId(),
    event,
    created_at: at.toISOString(),
    data: {
      invoice_id: invoice.id,
      reference: invoice.reference,
      status,
      amount_expected: amount(invoice.amountExpected),
      amount_settled: payment?.amountSettled ? amount(payment.amountSettled) : null,
      from_chain: payment?.fromChain ?? null,
      settled_at: payment?.settledAt?.toISOString() ?? null,
    },
  };
}
