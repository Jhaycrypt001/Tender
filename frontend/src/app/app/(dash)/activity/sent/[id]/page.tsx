import Link from "next/link";
import { LiveRefresh } from "@/components/dash/live-refresh";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { CopyValue } from "@/components/dash/copy";
import { Money, Timestamp } from "@/components/dash/money";
import { TxLink } from "@/components/dash/tx-link";
import { TransferStatePill } from "@/components/dash/state-pill";
import { getTransfer } from "@/lib/api/transfers";
import type { Transfer } from "@/lib/api/types";

export const metadata = { title: "Transfer · Tender" };

export const dynamic = "force-dynamic";

const KIND: Record<Transfer["kind"], string> = { PAYOUT: "Payout", REFUND: "Refund", SPLIT: "Split" };
const EXPLORER_TX = "https://monadvision.com/tx/";

/**
 * One transfer sent out of the merchant's wallet: every recipient, where each one's money went,
 * whether it has arrived, and the transaction. Live, so a cross-chain delivery flips from
 * Arriving to Delivered while the page is open.
 */
export default async function TransferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getTransfer(id);

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader back="/app/activity?filter=outgoing" eyebrow="Outgoing" title="Transfer" />
        <ErrorState error={result.error} />
      </PageShell>
    );
  }

  const t = result.data;
  const lines = t.lines;

  return (
    <PageShell>
      <LiveRefresh />
      <PageHeader
        back="/app/activity?filter=outgoing"
        eyebrow={`Outgoing · ${KIND[t.kind]}`}
        title={`${t.total_amount} ${t.asset} out`}
        actions={<TransferStatePill status={t.status} />}
      />

      {t.failure_reason && t.status !== "CONFIRMED" && (
        <Card tone="quiet" className="mb-4">
          <p className="text-[0.9375rem] leading-relaxed">{t.failure_reason}</p>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader label={lines.length > 1 ? `${lines.length} recipients` : "Recipient"} hint="Where the money went." />
          <ul className="flex flex-col divide-y divide-line">
            {lines.map((l, i) => (
              <li key={i} className="flex flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-4">
                  <span className="text-[0.9375rem]">{l.dest?.chain_name ?? "Monad"}</span>
                  <Money amount={l.amount} currency={t.asset} maxDp={6} />
                </div>
                <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-stone/60 px-3 py-2">
                  <code className="min-w-0 break-all font-mono text-[0.75rem]">{l.dest?.address ?? l.to}</code>
                  <CopyValue value={l.dest?.address ?? l.to} />
                </div>
                {l.dest && (
                  <dl className="flex flex-col gap-1.5 text-[0.8125rem]">
                    <Line label="Delivery">
                      {l.dest.status === "DELIVERED" ? "Delivered" : l.dest.status === "FAILED" ? "Not delivered" : t.status === "CONFIRMED" ? "Arriving…" : "Waiting to send"}
                    </Line>
                    <Line label="Arrives as">
                      {l.dest.expected_out ? `about ${l.dest.expected_out} ${l.dest.asset}` : l.dest.asset}
                    </Line>
                    {l.dest.delivered_at && (
                      <Line label="Delivered at">
                        <Timestamp value={l.dest.delivered_at} />
                      </Line>
                    )}
                    <Line label="Via Aurora, from">
                      <span className="font-mono text-[0.75rem] text-mute">{l.to.slice(0, 10)}…{l.to.slice(-6)}</span>
                    </Line>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card tone="quiet">
          <CardHeader label="Details" hint="From your wallet, on Monad." />
          <dl className="flex flex-col gap-3.5">
            <Line label="Type">{KIND[t.kind]}</Line>
            <Line label="Total">
              <Money amount={t.total_amount} currency={t.asset} maxDp={6} />
            </Line>
            <Line label="Created">
              <Timestamp value={t.created_at} />
            </Line>
            <Line label="Sent">{t.submitted_at ? <Timestamp value={t.submitted_at} /> : <span className="text-mute">&mdash;</span>}</Line>
            <Line label="Confirmed">{t.confirmed_at ? <Timestamp value={t.confirmed_at} /> : <span className="text-mute">&mdash;</span>}</Line>
            {t.note && <Line label="Note">{t.note}</Line>}
            {t.payment_id && (
              <Line label="Refund of">
                <Link href={`/app/activity/${t.payment_id}`} className="text-sand underline-offset-4 hover:underline">
                  View the payment
                </Link>
              </Line>
            )}
          </dl>

          {t.tx_hash && (
            <div className="mt-4 border-t border-line pt-3.5">
              <p className="mb-1.5 text-[0.75rem] uppercase tracking-[0.1em] text-mute">Transaction</p>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2">
                <TxLink chain="monad" hash={t.tx_hash} full className="min-w-0" />
                <CopyValue value={t.tx_hash} />
              </div>
              <a href={`${EXPLORER_TX}${t.tx_hash}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[0.8125rem] text-sand underline-offset-4 hover:underline">
                View on the Monad explorer &rarr;
              </a>
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[0.8125rem] text-mute">{label}</dt>
      <dd className="text-right text-[0.9375rem]">{children}</dd>
    </div>
  );
}
