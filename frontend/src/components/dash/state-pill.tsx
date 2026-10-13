import type { InvoiceStatus, PaymentStatus, TransferStatus } from "@/lib/api/types";

/**
 * The status badge.
 *
 * ⭐ The maps below are typed as `Record<InvoiceStatus, …>` on purpose. When the
 * backend adds a ninth status to the contract, this file stops compiling until
 * someone decides what colour it is — which is exactly the moment to think
 * about it, rather than shipping an unstyled pill to a merchant.
 *
 * On colour: there is no green in this product. Success is `--sand`, the same
 * ochre as everything else Tender treats as good. Four weights, by how much the
 * merchant has to DO:
 *   good ..... finished, nothing to do (soft ochre)
 *   pending .. in flight, nothing to do yet (ink outline)
 *   quiet .... over, nothing to do (grey, skipped by the eye)
 *   action ... a decision is waiting on the merchant: an overpayment to refund,
 *              an underpayment to chase or refund (solid ochre, hard to miss)
 *   attention  something BROKE and needs a person: NEEDS_RECOVERY, FAILED,
 *              not delivered (solid ink)
 * An overpaid invoice used to wear the same soft ochre as a settled one, and an
 * underpaid one was grey, so the two states that ask the merchant to act were
 * the two that looked like nothing was needed.
 */

type Variant = "good" | "pending" | "quiet" | "action" | "attention";

const VARIANT: Record<Variant, string> = {
  // Settled. Ochre fill, the product's one positive colour.
  good: "bg-sand/12 text-[#8a5c1d] border-sand/25",
  // In flight. Ink, so it reads as active without claiming success.
  pending: "bg-ink/[0.06] text-ink border-ink/12",
  // Over, but nothing to do. Deliberately low-contrast so a merchant's eye
  // skips it when scanning a list.
  quiet: "bg-transparent text-mute border-line",
  // A decision is waiting on the merchant (refund the extra, chase the shortfall).
  action: "bg-sand text-ink border-sand",
  // Something broke and needs a person. The loudest state.
  attention: "bg-ink text-paper border-ink",
};

const INVOICE_VARIANT: Record<InvoiceStatus, Variant> = {
  PENDING: "pending",
  DETECTED: "pending",
  SETTLED: "good",
  OVERPAID: "action",
  UNDERPAID: "action",
  EXPIRED: "quiet",
  CANCELLED: "quiet",
  NEEDS_RECOVERY: "attention",
};

/**
 * What the merchant is shown.
 *
 * The wire values are shouted constants; these are sentence case and say what
 * happened rather than naming a state machine. "Awaiting payment" is what
 * PENDING means to someone who is not reading our source.
 */
const INVOICE_LABEL: Record<InvoiceStatus, string> = {
  PENDING: "Awaiting payment",
  DETECTED: "Payment seen",
  SETTLED: "Settled",
  OVERPAID: "Overpaid",
  UNDERPAID: "Underpaid",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  NEEDS_RECOVERY: "Needs recovery",
};

const PAYMENT_VARIANT: Record<PaymentStatus, Variant> = {
  DETECTED: "pending",
  SETTLED: "good",
  FAILED: "attention",
  REFUNDED: "quiet",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  DETECTED: "Seen on chain",
  SETTLED: "Settled",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

const TRANSFER_VARIANT: Record<TransferStatus, Variant> = {
  AWAITING_SIGNATURE: "pending",
  SUBMITTED: "pending",
  CONFIRMED: "good",
  FAILED: "attention",
  EXPIRED: "quiet",
};

const TRANSFER_LABEL: Record<TransferStatus, string> = {
  AWAITING_SIGNATURE: "Waiting for you",
  SUBMITTED: "Sending",
  CONFIRMED: "Sent",
  FAILED: "Failed",
  EXPIRED: "Not sent",
};

function Pill({ variant, children }: { variant: Variant; children: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] uppercase leading-none tracking-[0.1em] ${VARIANT[variant]}`}
    >
      {/* A dot, not an icon: it carries the state at a glance in a dense table
          without needing a legend. */}
      <span
        aria-hidden="true"
        className="h-[0.3125rem] w-[0.3125rem] shrink-0 rounded-full bg-current"
      />
      {children}
    </span>
  );
}

export type DeliveryStatus = "PENDING" | "DELIVERED" | "FAILED";

const DELIVERY_VARIANT: Record<DeliveryStatus, Variant> = { PENDING: "pending", DELIVERED: "good", FAILED: "attention" };
const DELIVERY_LABEL: Record<DeliveryStatus, string> = { PENDING: "Arriving", DELIVERED: "Delivered", FAILED: "Not delivered" };

/** Where a cross-chain send got to after it left the wallet: on its way, arrived, or did not arrive. */
export function DeliveryStatePill({ status }: { status: DeliveryStatus }) {
  return <Pill variant={DELIVERY_VARIANT[status]}>{DELIVERY_LABEL[status]}</Pill>;
}

export function InvoiceStatePill({ status }: { status: InvoiceStatus }) {
  return <Pill variant={INVOICE_VARIANT[status]}>{INVOICE_LABEL[status]}</Pill>;
}

export function TransferStatePill({ status }: { status: TransferStatus }) {
  return <Pill variant={TRANSFER_VARIANT[status]}>{TRANSFER_LABEL[status]}</Pill>;
}

export function PaymentStatePill({ status }: { status: PaymentStatus }) {
  return <Pill variant={PAYMENT_VARIANT[status]}>{PAYMENT_LABEL[status]}</Pill>;
}

/**
 * Plain-language explanation of a status, for the one place a merchant needs
 * more than a pill — the invoice detail page.
 *
 * These earn their place: `UNDERPAID` and `NEEDS_RECOVERY` behave differently
 * in a way no badge can convey, and getting that wrong is a support ticket.
 */
export const INVOICE_STATUS_HELP: Record<InvoiceStatus, string> = {
  PENDING: "Addresses are live. Nothing has arrived yet.",
  DETECTED:
    "A deposit has been seen on chain and is being routed. No action needed.",
  SETTLED: "Paid in full and settled to your Monad address.",
  OVERPAID:
    "Settled, and the buyer sent more than the invoice asked for. The excess is yours to send back: use Refund the extra below.",
  UNDERPAID:
    "The payments added up to less than the invoice asked for by the time it closed. What arrived reached your address: ask for the rest with a new invoice, or send it back.",
  EXPIRED: "The deadline passed with nothing received.",
  CANCELLED: "You cancelled this invoice before it was paid.",
  NEEDS_RECOVERY:
    "The deposit succeeded but the routing step failed afterwards, so it was NOT auto-refunded. Retry settling, or request a withdrawal (Tender prepares the support case for Aurora) from the payment below.",
};
