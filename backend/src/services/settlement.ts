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
 * Settled payments ADD UP. Aurora still routes and pays out every deposit on
 * its own (constraint #3, each is its own Payment row), but whether the invoice
 * is paid is decided on what has settled in total: a buyer who sends $2 and
 * then $3 against a $5 invoice has paid it. Payments are taken oldest first,
 * and the invoice settles at the payment that brings the total to the amount.
 * Anything that arrives after that point is an extra payment and makes it
 * OVERPAID, as does a total above the amount plus tolerance.
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
  if (status === "SETTLED") {
    const settling = coveringPayments(input);
    const extra = payments.some((p) => p.status !== "FAILED" && !settling?.used.includes(p));
    return settling && extra ? "OVERPAID" : "SETTLED";
  }
  if (status !== "PENDING" && status !== "DETECTED") return status;

  // A deposit that landed and then failed onward is never refunded
  // automatically. It gets its own terminal state and a recovery task.
  if (payments.some((p) => p.status === "FAILED")) return "NEEDS_RECOVERY";

  const paid = coveringPayments(input);
  if (paid) {
    const extra = payments.filter((p) => p.status !== "FAILED" && !paid.used.includes(p)).length > 0;
    return paid.total.gt(band(input, +1)) || extra ? "OVERPAID" : "SETTLED";
  }

  if (payments.length === 0) return input.closed ? "EXPIRED" : "PENDING";

  // Money arrived but together it does not cover the invoice. While payments
  // are still in flight or the buyer could still top up, wait. Once the window
  // has closed and everything has resolved, it is UNDERPAID. What settled
  // reached the merchant: it is not refunded automatically.
  const unresolved = payments.some((p) => p.status === "DETECTED");
  return input.closed && !unresolved ? "UNDERPAID" : "DETECTED";
}

/**
 * The settled payments, oldest first, that together reach the amount: the
 * shortest run that does. Null while they fall short. A payment that cannot be
 * valued adds nothing until it is.
 */
function coveringPayments(input: JudgeInput): { used: PaymentView[]; total: Decimal } | null {
  const floor = band(input, -1);
  const used: PaymentView[] = [];
  let total = new Decimal(0);
  for (const p of input.payments) {
    if (p.status !== "SETTLED" || p.amountInUsd === null) continue;
    used.push(p);
    total = total.add(p.amountInUsd);
    if (total.gte(floor)) return { used, total };
  }
  return null;
}

/** What has settled so far, in USD: the part of an invoice that has reached the merchant. */
export function settledTotal(payments: PaymentView[]): Decimal {
  return payments.reduce((sum, p) => (p.status === "SETTLED" && p.amountInUsd !== null ? sum.add(p.amountInUsd) : sum), new Decimal(0));
}

/** expected × (1 ± tolerance). */
function band(input: JudgeInput, sign: 1 | -1): Decimal {
  return new Decimal(input.amountExpected).mul(new Decimal(1).add(new Decimal(input.toleranceBps).div(10_000).mul(sign)));
}

/* -------------------------------------------------------------------------- */
/* Matching payout outcomes to deposits                                        */
/* -------------------------------------------------------------------------- */

export type OpenPayment = {
  id: string;
  auroraTxHash: string;
  firstSeenAt: Date;
  /** USD value of what was sent, at detection. Used to tell apart deposits that are waiting at the same time. */
  amountInUsd?: { toString(): string } | null;
};
/** `amount` (base units) and `decimals` are what was paid out, in the settlement stablecoin. */
export type Outcome = { tx_hash: string; created_at: string; amount?: string; decimals?: number | null };

/**
 * How far above a deposit's USD value at detection its payout may be and still
 * belong to it. A payout is normally a little LESS than the deposit (route
 * costs come out of it); the allowance only absorbs price movement between
 * detection and payout.
 */
const PAYOUT_ABOVE_DEPOSIT = new Decimal("1.02");

/**
 * Pairs each unrecorded payout outcome (a `success` or `failed` entry) with
 * the deposit it belongs to.
 *
 * Checked live on 2026-10-07: an outcome does NOT carry the deposit's tx hash
 * (a Base deposit 0x9dec… was paid out as 0xdccb… on Monad). So:
 *   1. an outcome whose tx_hash equals a deposit's is matched to it directly;
 *   2. otherwise, if both values are known, to the waiting deposit whose USD
 *      value best explains the payout (the payout is that value less route
 *      costs). Deposits from different chains settle at different speeds, so
 *      on an address that takes many deposits — a standing address — the
 *      oldest waiting deposit is often NOT the one being paid out;
 *   3. otherwise to the oldest waiting deposit.
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
    if (!remaining.length) {
      orphans.push(outcome);
      continue;
    }
    const byValue = bestByValue(remaining, outcome);
    take(byValue ?? 0, outcome);
  }
  return { pairs, orphans };
}

/**
 * The index of the waiting deposit whose USD value best explains this payout,
 * or null when that cannot be judged (no payout amount, or no deposit it fits).
 * A deposit fits when it arrived before the payout and the payout is not more
 * than it was worth (beyond `PAYOUT_ABOVE_DEPOSIT`). Among those that fit, the
 * smallest gap wins: that is the deposit the payout is a fee-reduced copy of.
 */
function bestByValue(remaining: OpenPayment[], outcome: Outcome): number | null {
  if (outcome.amount === undefined || outcome.decimals === undefined || outcome.decimals === null) return null;
  let paid: Decimal;
  try {
    paid = new Decimal(outcome.amount).div(new Decimal(10).pow(outcome.decimals));
  } catch {
    return null;
  }
  const paidAt = new Date(outcome.created_at).getTime();

  let best: { index: number; gap: Decimal } | null = null;
  remaining.forEach((p, index) => {
    if (p.amountInUsd === null || p.amountInUsd === undefined) return;
    if (p.firstSeenAt.getTime() > paidAt) return;
    const sent = new Decimal(p.amountInUsd.toString());
    if (paid.gt(sent.mul(PAYOUT_ABOVE_DEPOSIT))) return;
    const gap = sent.sub(paid).abs();
    if (!best || gap.lt(best.gap)) best = { index, gap };
  });
  return best ? (best as { index: number }).index : null;
}
