import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { Money, Timestamp } from "@/components/dash/money";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { getMerchant } from "@/lib/api/merchant";
import { listPayments } from "@/lib/api/payments";
import { chainLabel } from "@/lib/chains";
import type { ListPaymentsQuery, Payment } from "@/lib/api/types";

export const metadata = { title: "Ask · Tender" };

export const dynamic = "force-dynamic";

/**
 * Ask — answers to the questions a merchant actually has.
 *
 * ⚠️ The plan called this screen "natural-language query", and it is
 * deliberately NOT that. There is no language endpoint and no search endpoint
 * in the §5 contract: the payments API takes `status` and `invoice_status`,
 * both enums, and nothing else. A free-text box here could only keyword-match
 * those two fields while LOOKING like it understood the sentence — so it would
 * answer "how much did I make in July" with a silent, confident wrong number,
 * because it has no date filter to apply and no way to say so.
 *
 * A question the merchant picks is honest about its own limits. A text box
 * that quietly ignores half of what was typed is not. So this ships as a small
 * set of real questions, each one a query the API can genuinely answer, with
 * the answer computed from the response and the working shown underneath.
 *
 * When a search or aggregate endpoint exists, this screen is where it lands —
 * the questions become the examples rather than the whole feature.
 */

/** How many payments one question reads. */
const LIMIT = 100;

type Question = {
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

type Total = {
  /** The summed settlement amount, as a decimal string. */
  amount: string;
  /** Rows that carried a settled amount and are inside `amount`. */
  counted: number;
  /** Rows with nothing settled yet, deliberately left out of `amount`. */
  unsettled: number;
};

function total(rows: Payment[]): Total {
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

const QUESTIONS: Question[] = [
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

export default async function AskPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const asked = QUESTIONS.find((item) => item.slug === q) ?? null;

  return (
    <PageShell>
      <PageHeader
        back="/app/home"
        eyebrow="Ask"
        title="Question your ledger."
        description="Questions about your money, answered from your live payment data."
      />

      {/* Rendered regardless of any result: these are navigation, and hiding
          them behind a failed fetch makes the screen look broken, not empty. */}
      <nav aria-label="Questions" className="mb-5 flex flex-wrap gap-1.5">
        {QUESTIONS.map((item) => {
          const on = asked?.slug === item.slug;
          return (
            <Link
              key={item.slug}
              href={on ? "/app/ask" : `/app/ask?q=${item.slug}`}
              aria-current={on ? "page" : undefined}
              className={`rounded-full border px-3.5 py-1.5 text-[0.8125rem] transition-colors ${
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-mute hover:border-mute/50 hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {asked ? (
        <Answer question={asked} />
      ) : (
        <Card tone="quiet">
          <CardHeader
            label="Pick a question"
            hint="Each one runs against your live payments. The answer shows what it counted and what it left out."
          />
          <p className="text-[0.9375rem] leading-relaxed text-mute">
            These are questions Tender can answer exactly. Anything needing a
            date range or a text search is not here yet, because the API cannot
            answer it honestly — and a number that looks right but quietly
            ignored half your question is worse than no number at all.
          </p>
        </Card>
      )}
    </PageShell>
  );
}

async function Answer({ question }: { question: Question }) {
  /**
   * The merchant is fetched only for the settlement asset's ticker, so a
   * failure here must not take the answer down with it: an amount with no
   * ticker is still a true amount, whereas no answer at all is a broken
   * screen. The label is simply omitted when it is not known — never guessed,
   * because labelling MON as USDC is worse than labelling nothing.
   */
  const [result, merchant] = await Promise.all([
    listPayments({ ...question.query, limit: LIMIT }),
    getMerchant(),
  ]);

  if (!result.ok) {
    return <ErrorState error={result.error} />;
  }

  const settlementAsset = merchant.ok
    ? (merchant.data.settlement_asset ?? "")
    : "";

  const rows = result.data.data;

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader label={question.label} />
        <p className="font-display text-[1.5rem] leading-tight tracking-[-0.02em]">
          {question.zero}
        </p>
        <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
          {question.caveat}
        </p>
      </Card>
    );
  }

  const answer = total(rows);

  // `has_more` matters: the answer covers only what was read, and saying
  // otherwise understates the merchant's own money without telling them.
  const capped = result.data.has_more;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader label={question.label} />

        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-display text-[2rem] leading-none tracking-[-0.03em]">
            <Money amount={answer.amount} maxDp={8} />
          </span>
          {settlementAsset && (
            <span className="font-mono text-[0.8125rem] tracking-[0.08em] text-mute">
              {settlementAsset}
            </span>
          )}
          <span className="text-[0.8125rem] text-mute">
            across {answer.counted}{" "}
            {answer.counted === 1 ? "payment" : "payments"}
          </span>
        </p>

        <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
          {question.caveat}
          {/* ⚠️ Said out loud rather than folded into the total. A row that
              has not settled has landed nowhere, so counting it as zero would
              make the number look complete when it is not. */}
          {answer.unsettled > 0 && (
            <>
              {" "}
              {answer.unsettled}{" "}
              {answer.unsettled === 1 ? "payment has" : "payments have"} not
              settled yet and {answer.unsettled === 1 ? "is" : "are"} not in
              this total.
            </>
          )}
          {capped && (
            <>
              {" "}
              This counts the most recent {LIMIT} payments only — there are more
              than that, so the real total is higher.
            </>
          )}
        </p>
      </Card>

      <Card tone="quiet">
        <CardHeader
          label="What this counted"
          hint="Every payment behind the number above, so you can check it yourself."
        />
        <ul className="flex flex-col">
          {rows.map((payment) => (
            <li
              key={payment.id}
              className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0"
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link
                  href={`/app/activity/${payment.id}`}
                  className="text-[0.9375rem] underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
                >
                  {chainLabel(payment.from_chain)}
                </Link>
                <span className="text-[0.75rem] text-mute">
                  <Timestamp value={payment.first_seen_at} />
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                {/* The settled amount, so each row matches the total
                    above it. A row still in flight has none, and says so
                    rather than showing a zero. */}
                <span className="text-[0.9375rem]">
                  {payment.amount_settled ? (
                    <Money amount={payment.amount_settled} maxDp={8} />
                  ) : (
                    <span className="text-mute">not settled</span>
                  )}
                </span>
                <PaymentStatePill status={payment.status} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
