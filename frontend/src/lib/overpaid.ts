import type { Invoice, Payment } from "@/lib/api/types";
import { fromMicro, toMicro } from "@/lib/micro";

/** A dollar invoice: what landed and what was due are in the same unit, so the extra can be worked out. */
export const isDollarInvoice = (invoice: Pick<Invoice, "currency">) => ["USD", "USDC"].includes(invoice.currency.toUpperCase());

/**
 * How much of an overpaid invoice to suggest refunding, and from which payment.
 *
 * Payments add up, so the extra is what landed across ALL settled payments, minus anything already
 * refunded, minus the amount due: $3 then $4 on a $5 invoice is $2 over, not the whole $4. It is
 * suggested on the latest settled payment (the one that went over), capped at what that payment can
 * still return. Only for a dollar invoice, where what landed and what was due share a unit.
 *
 * A suggestion, never a limit: the merchant can still type any amount the payment allows.
 */
export function overpaidRefund(invoice: Pick<Invoice, "currency" | "amount_expected" | "payments">): { paymentId: string; amount: string } | null {
  if (!isDollarInvoice(invoice)) return null;
  const settled = (invoice.payments ?? []).filter((p) => p.status === "SETTLED" && p.amount_settled);
  const target = settled[settled.length - 1];
  const due = toMicro(invoice.amount_expected);
  if (!target || due === null) return null;

  let landed = BigInt(0);
  for (const p of settled) landed += left(p);
  const extra = landed - due;
  if (extra <= BigInt(0)) return null;

  const cap = left(target);
  const amount = extra < cap ? extra : cap;
  return amount > BigInt(0) ? { paymentId: target.id, amount: fromMicro(amount) } : null;
}

/** What a payment can still return: what it delivered, minus what has already gone back. */
function left(p: Pick<Payment, "amount_settled" | "refunded_amount">): bigint {
  const settled = toMicro(p.amount_settled ?? "0") ?? BigInt(0);
  const refunded = toMicro(p.refunded_amount ?? "0") ?? BigInt(0);
  return settled > refunded ? settled - refunded : BigInt(0);
}
