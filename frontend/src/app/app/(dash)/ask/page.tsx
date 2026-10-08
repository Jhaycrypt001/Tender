import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { Money, Timestamp } from "@/components/dash/money";
import { FiatMoney } from "@/components/dash/currency";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { getMerchant } from "@/lib/api/merchant";
import { listPayments } from "@/lib/api/payments";
import { chainLabel } from "@/lib/chains";
import { LIMIT, QUESTIONS, total, type Question } from "@/lib/ask";

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
        description="Ask about your money."
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
            hint="Answers come from your live payments."
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
          hint="The payments behind the number."
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
                    <FiatMoney amount={payment.amount_settled} maxDp={8} />
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
