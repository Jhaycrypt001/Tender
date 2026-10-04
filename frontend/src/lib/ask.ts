import type { ListPaymentsQuery, Payment } from "@/lib/api/types";

/**
 * The questions Ask can answer exactly, and the arithmetic behind them.
 *
 * Shared by the /app/ask page and the in-page Ask assistant, so a preset
 * question gets the same answer from the same code wherever it is asked.
 * See the note on the Ask page for why these are a fixed set.
 */

/** How many payments one question reads. */
export const LIMIT = 100;

export type Question = {
  slug: string;
  /** Asked the way a merchant would say it. */
  label: string;
  query: ListPaymentsQuery;
  /** Said when the answer is zero, in the merchant's terms rather than "none". */
  zero: string;
  /** What the number does and does not include. Always shown, never on hover. */
  caveat: string;
};

/**
 * ⚠️ Sums `amount_settled`, NEVER `amount_in`.
 *
 * `amount_in` is what the buyer sent, in the SOURCE asset — and `Payment`
 * carries no currency field to say which asset that was. Adding those rows
 * together adds BTC to SOL to USDC and produces a number that is not money in
 * any unit. `amount_settled` is what landed at the merchant's address, and
 * every row of it is in the merchant's one settlement asset, so it is the only
 * field on this type that can honestly be added up.
 *
 * It is optional, because a payment that has not settled has not landed
 * anywhere yet. Those rows are counted separately and reported, rather than
 * treated as zero — a pending payment is not a payment of nothing.
 *
 * Fixed-point over the raw strings, because these are up to 18-decimal values
 * and a float cannot hold them. `Number()` here would silently round the
 * merchant's own money, which is the one thing this screen must never do.
 */
const DP = 18;
const SCALE = BigInt(10) ** BigInt(DP);

export type Total = {
  /** The summed settlement amount, as a decimal string. */
  amount: string;
  /** Rows that carried a settled amount and are inside `amount`. */
  counted: number;
  /** Rows with nothing settled yet, deliberately left out of `amount`. */
  unsettled: number;
};

export function total(rows: Payment[]): Total {
  let acc = BigInt(0);
  let counted = 0;
  let unsettled = 0;

  for (const row of rows) {
    const raw = row.amount_settled;
    if (raw === null || raw === undefined || raw === "") {
      unsettled += 1;
      continue;
    }

    const [whole = "0", frac = ""] = String(raw).trim().split(".");
    // A malformed amount is skipped rather than guessed at. One bad row must
    // not take the whole answer down, and must not quietly become a zero that
    // reads like real data.
    if (!/^\d+$/.test(whole) || !/^\d*$/.test(frac)) {
      unsettled += 1;
      continue;
    }

    const padded = (frac + "0".repeat(DP)).slice(0, DP);
    acc += BigInt(whole) * SCALE + BigInt(padded || "0");
    counted += 1;
  }

  const int = acc / SCALE;
  const rest = (acc % SCALE).toString().padStart(DP, "0").replace(/0+$/, "");
  return { amount: rest ? `${int}.${rest}` : `${int}`, counted, unsettled };
}

export const QUESTIONS: Question[] = [
  {
    slug: "settled",
    label: "How much have I been paid?",
    query: { status: "SETTLED" },
    zero: "Nothing has settled yet.",
    caveat:
      "Totals what buyers sent on payments that reached your settlement address. Network fees mean the amount that landed is slightly lower.",
  },
  {
    slug: "in-flight",
    label: "Is anything on its way right now?",
    query: { status: "DETECTED" },
    zero: "Nothing is in flight. Everything seen on chain has finished settling.",
    caveat:
      "Payments spotted on chain that have not finished settling. These usually resolve on their own within minutes.",
  },
  {
    slug: "needs-me",
    label: "Is anything stuck and waiting on me?",
    query: { invoice_status: "NEEDS_RECOVERY" },
    zero: "Nothing needs you. No payment is stuck.",
    caveat:
      "The deposit arrived but the onward settlement did not complete. This is not refunded automatically — retry it, or request a withdrawal, from the payment page.",
  },
  {
    slug: "refunded",
    label: "What went back to buyers?",
    query: { status: "REFUNDED" },
    zero: "Nothing has been refunded.",
    caveat:
      "Includes both refunds you sent and deposits the network returned automatically for falling under a chain minimum.",
  },
];
