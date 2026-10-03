import type { InvoiceStatus, PaymentStatus } from "@/lib/api/types";

/**
 * The status badge.
 *
 * ⭐ The maps below are typed as `Record<InvoiceStatus, …>` on purpose. When the
 * backend adds a ninth status to the contract, this file stops compiling until
 * someone decides what colour it is — which is exactly the moment to think
 * about it, rather than shipping an unstyled pill to a merchant.
 *
 * On colour: there is no green in this product. Success is `--sand`, the same
 * ochre as everything else Tender treats as good. Failure states are not red
 * either — a merchant reading "UNDERPAID" does not need to be alarmed, they
 * need to know it was refunded automatically. Only the two states that need a
 * human are given real visual weight: NEEDS_RECOVERY and FAILED.
 */

type Variant = "good" | "pending" | "quiet" | "attention";

const VARIANT: Record<Variant, string> = {
  // Settled. Ochre fill, the product's one positive colour.
  good: "bg-sand/12 text-[#8a5c1d] border-sand/25",
  // In flight. Ink, so it reads as active without claiming success.
  pending: "bg-ink/[0.06] text-ink border-ink/12",
  // Over, but nothing to do. Deliberately low-contrast so a merchant's eye
  // skips it when scanning a list.
  quiet: "bg-transparent text-mute border-line",
  // Needs a person. The only state that is allowed to be loud.
  attention: "bg-ink text-paper border-ink",
};

const INVOICE_VARIANT: Record<InvoiceStatus, Variant> = {
  PENDING: "pending",
  DETECTED: "pending",
  SETTLED: "good",
  OVERPAID: "good",
  UNDERPAID: "quiet",
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

export function InvoiceStatePill({ status }: { status: InvoiceStatus }) {
  return <Pill variant={INVOICE_VARIANT[status]}>{INVOICE_LABEL[status]}</Pill>;
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
    "Settled, and the buyer sent more than the invoice asked for. The excess is recorded against this invoice.",
  UNDERPAID:
    "Less than the amount arrived before the invoice closed. A deposit below the chain minimum was refunded to the sender automatically; anything above it reached your address — see the payments below.",
  EXPIRED: "The deadline passed with nothing received.",
  CANCELLED: "You cancelled this invoice before it was paid.",
  NEEDS_RECOVERY:
    "The deposit succeeded but the routing step failed afterwards, so it was NOT auto-refunded. Retry settling, or request a withdrawal (Tender prepares the support case for Aurora) from the payment below.",
};
