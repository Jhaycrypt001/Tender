import type { InvoiceStatus, PaymentStatus } from "../generated/prisma/client.js";
import { Decimal } from "../lib/money.js";

/**
 * The invoice rules, as pure functions. No database, no clock, no Aurora:
 * everything they need is passed in, so every rule is unit-tested directly.
 *
 * ── How payments are judged ────────────────────────────────────────────────
 *
 * Coverage is judged on the USD value of what the buyer SENT, at detection,
 * using Aurora's price feed. Fees and swap spread come out of what the merchant
 * RECEIVES, exactly as with a card processor — so judging on the settled
 * amount would mark every correct payment as short.
 *
 * `toleranceBps` absorbs price-feed lag: a payment within the tolerance of the
 * expected amount counts as exact.
 *
 * Payments are judged ONE AT A TIME, never summed. Aurora settles each deposit
 * independently (constraint #3), and the published contract says never to sum
 * partial payments into a settlement. A second payment after a settling one
 * makes the invoice OVERPAID, as /docs promises ("the first settles the
 * invoice; the second is recorded and reported as an overpayment").
 */

export type PaymentView = {
  status: PaymentStatus;
  /** USD value at detection; null when no price was available. */
  amountInUsd: string | null;
};

export type JudgeInput = {
  status: InvoiceStatus;
  amountExpected: string;
  payments: PaymentView[];
  /** Past the deadline plus grace: nothing more is expected. */
  closed: boolean;
  toleranceBps: number;
};

export function judge(input: JudgeInput): InvoiceStatus {
  const { status, payments } = input;

  // Terminal states never move — with the one published exception: a later
  // payment turns SETTLED into OVERPAID.
  if (status === "SETTLED") return hasExtraPayment(input) ? "OVERPAID" : "SETTLED";
  if (status !== "PENDING" && status !== "DETECTED") return status;

  // A deposit that landed and then failed onward is never refunded
  // automatically. It gets its own terminal state and a recovery task.
  if (payments.some((p) => p.status === "FAILED")) return "NEEDS_RECOVERY";

  const covering = payments.find((p) => p.status === "SETTLED" && covers(p, input));
  if (covering) {
    return exceeds(covering, input) || hasExtraPayment(input) ? "OVERPAID" : "SETTLED";
  }

  if (payments.length === 0) return input.closed ? "EXPIRED" : "PENDING";

  // Money arrived but no single payment covers the invoice. While payments are
  // still in flight or the buyer could still top up, wait. Once the window has
  // closed and everything has resolved, it is UNDERPAID.
  // ⚠️ Open question for the frontend owner: /docs describes UNDERPAID as
  // "refunded automatically", which is true of a sub-minimum deposit but NOT
  // of a partial payment that settled — that money reached the merchant.
  const unresolved = payments.some((p) => p.status === "DETECTED");
  return input.closed && !unresolved ? "UNDERPAID" : "DETECTED";
}

function covers(p: PaymentView, input: JudgeInput): boolean {
  if (p.amountInUsd === null) return false;
  return new Decimal(p.amountInUsd).gte(band(input, -1));
}

function exceeds(p: PaymentView, input: JudgeInput): boolean {
  return p.amountInUsd !== null && new Decimal(p.amountInUsd).gt(band(input, +1));
}

/** Any payment beyond the first that is not a failure. */
function hasExtraPayment(input: JudgeInput): boolean {
  return input.payments.filter((p) => p.status !== "FAILED").length > 1;
}

/** expected × (1 ± tolerance). */
function band(input: JudgeInput, sign: 1 | -1): Decimal {
  return new Decimal(input.amountExpected).mul(new Decimal(1).add(new Decimal(input.toleranceBps).div(10_000).mul(sign)));
}

/* -------------------------------------------------------------------------- */
/* Matching payout outcomes to deposits                                        */
/* -------------------------------------------------------------------------- */

export type OpenPayment = { id: string; auroraTxHash: string; firstSeenAt: Date };
export type Outcome = { tx_hash: string; created_at: string };

/**
 * Pairs each unrecorded payout outcome (a `success` or `failed` entry) with
 * the deposit it belongs to.
 *
 * ⚠️ Unverified against a real payment (BACKEND.md §1): we do not yet know
 * whether an outcome carries the deposit's tx hash. So:
 *   1. an outcome whose tx_hash equals a deposit's is matched to it directly;
 *   2. otherwise outcomes pair with open deposits in chronological order.
 * Every invoice has its own addresses (sender = invoice id), so any outcome on
 * an address belongs to that invoice — only the pairing within it is inferred.
 * Outcomes with no open deposit left are returned as `orphans` and logged.
 */
export function matchOutcomes(open: OpenPayment[], outcomes: Outcome[]) {
  const remaining = [...open].sort((a, b) => a.firstSeenAt.getTime() - b.firstSeenAt.getTime());
  const pairs: Array<{ paymentId: string; outcome: Outcome }> = [];
  const orphans: Outcome[] = [];

  const take = (index: number, outcome: Outcome) => {
    const [payment] = remaining.splice(index, 1);
    if (payment) pairs.push({ paymentId: payment.id, outcome });
  };

  const sorted = [...outcomes].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const unmatched: Outcome[] = [];
  for (const outcome of sorted) {
    const direct = remaining.findIndex((p) => p.auroraTxHash === outcome.tx_hash);
    if (direct >= 0) take(direct, outcome);
    else unmatched.push(outcome);
  }
  for (const outcome of unmatched) {
    if (remaining.length) take(0, outcome);
    else orphans.push(outcome);
  }
  return { pairs, orphans };
}
