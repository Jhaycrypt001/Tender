import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { CopyValue } from "@/components/dash/copy";
import { Money, Timestamp } from "@/components/dash/money";
import { FiatMoney } from "@/components/dash/currency";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { getPayment } from "@/lib/api/payments";
import { chainLabel } from "@/lib/chains";
import { RecoveryActions } from "./recovery";

export const metadata = { title: "Payment · Tender" };

export const dynamic = "force-dynamic";

/**
 * One payment.
 *
 * A reconciliation screen, so it answers three questions in order: what
 * arrived, where it came from, and what has happened to it since. The history
 * is the point — a merchant opens this screen because something did not go
 * the way they expected.
 */
export default async function PaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getPayment(id);

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader
          back="/app/activity"
          eyebrow="Ledger"
          title="Payment"
          actions={
            <Link
              href="/app/activity"
              className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              Back
            </Link>
          }
        />
        <ErrorState error={result.error} />
      </PageShell>
    );
  }

  const p = result.data;

  return (
    <PageShell>
      <PageHeader
        back="/app/activity"
        eyebrow={"Paid from " + chainLabel(p.from_chain)}
        title={p.amount_in + " in"}
        actions={<PaymentStatePill status={p.status} />}
      />

      {/* First, because a payment that needs recovery is the only reason this
          screen is ever urgent. Ink so it carries weight without a red that
          the palette does not have. */}
      {p.recovery && (
        <Card tone="ink" pad="lg" marks className="mb-4">
          <CardHeader
            label="Needs recovery"
            hint="Settlement failed after the deposit landed."
          />
          <RecoveryActions
            paymentId={p.id}
            reason={p.recovery.reason}
            state={p.recovery.state}
          />
          {p.recovery.notes && (
            <p className="mt-4 border-t border-paper/12 pt-3 text-[0.8125rem] leading-relaxed text-paper/60">
              {p.recovery.notes}
            </p>
          )}
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader
            label="What arrived"
            hint="What the buyer sent, and what reached you."
          />
          <dl className="flex flex-col gap-3.5">
            <Line label={"Sent on " + chainLabel(p.from_chain)}>
              {/* No currency label: amount_in is in the SOURCE asset, and
                  labelling 0.00042 BTC as USDC would misstate what moved. */}
              <Money amount={p.amount_in} currency={p.asset_in ?? undefined} maxDp={8} />
            </Line>
            <Line label="Settled to you">
              {p.amount_settled ? (
                <FiatMoney amount={p.amount_settled} currency={p.invoice.currency} />
              ) : (
                <span className="text-mute">Not settled yet</span>
              )}
            </Line>
            {p.refunded_amount && Number(p.refunded_amount) > 0 ? (
              <Line label="Refunded to the buyer">
                <FiatMoney amount={p.refunded_amount} currency={p.invoice.currency} />
              </Line>
            ) : null}
            <Line label="First seen">
              <Timestamp value={p.first_seen_at} />
            </Line>
            <Line label="Settled at">
              {p.settled_at ? (
                <Timestamp value={p.settled_at} />
              ) : (
                <span className="text-mute">&mdash;</span>
              )}
            </Line>
          </dl>

          <div className="mt-4 border-t border-line pt-3.5">
            <p className="mb-1.5 text-[0.75rem] uppercase tracking-[0.1em] text-mute">
              Transaction
            </p>
            <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-stone/60 px-3 py-2">
              <code className="min-w-0 break-all font-mono text-[0.75rem]">
                {p.tx_hash}
              </code>
              <CopyValue value={p.tx_hash} />
            </div>
          </div>
        </Card>

        {p.source === "deposit" ? (
          <Card tone="quiet">
            <CardHeader
              label="Direct deposit"
              hint="Sent to your deposit address, not against an invoice."
            />
            <p className="text-[0.875rem] leading-relaxed text-mute">
              There is no order or amount owed behind this payment: it is
              whatever was sent to your standing deposit address.
            </p>
            <Link
              href="/app/deposit"
              className="mt-4 inline-flex items-center gap-1.5 border-t border-line pt-3.5 text-[0.875rem] text-sand underline-offset-4 hover:underline"
            >
              Your deposit address
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </Card>
        ) : (
          <Card tone="quiet">
            <CardHeader
              label="Against invoice"
              hint="The order this payment was made towards."
            />
            <dl className="flex flex-col gap-3.5">
              <Line label="Your reference">{p.invoice.reference}</Line>
              <Line label="Amount owed">
                <FiatMoney
                  amount={p.invoice.amount_expected}
                  currency={p.invoice.currency}
                />
              </Line>
            </dl>
            <Link
              href={"/app/checkout/" + p.invoice.id}
              className="mt-4 inline-flex items-center gap-1.5 border-t border-line pt-3.5 text-[0.875rem] text-sand underline-offset-4 hover:underline"
            >
              Open the invoice
              <span aria-hidden="true">&rarr;</span>
            </Link>
          </Card>
        )}
      </div>

      <div className="mt-7">
        <SectionHeader label="History" />
        {p.history.length === 0 ? (
          <Card tone="quiet">
            <p className="text-[0.875rem] leading-relaxed text-mute">
              No state changes have been recorded for this payment yet.
            </p>
          </Card>
        ) : (
          <Card>
            {/* A list, not a table: this is a sequence and its whole meaning
                is the order. Newest last, so it reads top to bottom. */}
            <ol className="flex flex-col">
              {p.history.map((h, i) => (
                <li
                  key={h.at + "-" + h.status + "-" + i}
                  className="relative flex gap-4 pb-5 last:pb-0"
                >
                  {/* The rail stops at the final dot rather than trailing
                      into nothing. */}
                  <div className="flex shrink-0 flex-col items-center">
                    <span
                      aria-hidden="true"
                      className={
                        "mt-1.5 size-2 rounded-full " +
                        (i === p.history.length - 1 ? "bg-sand" : "bg-line")
                      }
                    />
                    {i < p.history.length - 1 && (
                      <span aria-hidden="true" className="mt-1 w-px flex-1 bg-line" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-[0.9375rem]">{h.status}</p>
                    <p className="mt-0.5 text-[0.8125rem] text-mute">
                      <Timestamp value={h.at} />
                    </p>
                    {h.note && (
                      <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-mute">
                        {h.note}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </PageShell>
  );
}

/** One label/value row. Local because it exists only on this screen. */
function Line({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[0.8125rem] text-mute">{label}</dt>
      <dd className="text-right text-[0.9375rem]">{children}</dd>
    </div>
  );
}
