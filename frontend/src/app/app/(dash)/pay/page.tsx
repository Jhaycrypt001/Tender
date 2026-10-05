import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { Hash, Timestamp } from "@/components/dash/money";
import { TransferStatePill } from "@/components/dash/state-pill";
import { listTransfers } from "@/lib/api/transfers";
import { explorerTx } from "./send-ui";

export const metadata = { title: "Pay · Tender" };

export const dynamic = "force-dynamic";

/**
 * Outbound money: the hub.
 *
 * All three are the merchant's own wallet signing a transfer, which Tender
 * relays and pays the network fee for. Tender never holds the money. A
 * transfer is shown as Sent only once the chain has confirmed it.
 */

const ROUTES = [
  {
    href: "/app/pay/refund",
    label: "Refund",
    desc: "Return money to a buyer for a payment that settled, up to what it delivered.",
  },
  {
    href: "/app/pay/payout",
    label: "Payout",
    desc: "Send settled revenue to a supplier or a contractor.",
  },
  {
    href: "/app/pay/split",
    label: "Split",
    desc: "Divide one amount across several addresses. Everyone is paid together, or nobody is.",
  },
] as const;

const KIND: Record<string, string> = { PAYOUT: "Payout", REFUND: "Refund", SPLIT: "Split" };

export default async function PayPage() {
  const recent = await listTransfers(10);

  return (
    <PageShell>
      <PageHeader
        back="/app/home"
        eyebrow="Pay"
        title="Money going back out."
        description="Refunds to buyers, payouts to suppliers, splits across a team."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {ROUTES.map((r) => (
          <Link
            key={r.href}
            href={r.href}
            className="group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
          >
            <Card className="h-full transition-colors group-hover:border-mute/50">
              <CardHeader label={r.label} />
              <p className="text-[0.875rem] leading-relaxed text-mute">{r.desc}</p>
              <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-ink">
                Open
                <span aria-hidden="true" className="ml-1.5 text-sand">
                  &rarr;
                </span>
              </p>
            </Card>
          </Link>
        ))}
      </div>

      {recent.ok && recent.data.data.length > 0 && (
        <section className="mt-8" aria-labelledby="recent-transfers">
          <Card>
            <CardHeader label="Recent transfers" hint="What you have sent from your wallet, and what the network says about each." />
            <h2 id="recent-transfers" className="sr-only">
              Recent transfers
            </h2>
            <ul className="flex flex-col divide-y divide-line">
              {recent.data.data.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[0.9375rem]">
                      {KIND[t.kind] ?? t.kind}
                      <span className="ml-2 tabular-nums">
                        {t.total_amount} {t.asset}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-baseline gap-x-3 text-[0.75rem] text-mute">
                      <span>
                        to <Hash value={t.lines[0]?.to ?? ""} />
                        {t.lines.length > 1 ? ` and ${t.lines.length - 1} more` : ""}
                      </span>
                      <Timestamp value={t.created_at} />
                      {t.note ? <span className="truncate">{t.note}</span> : null}
                    </span>
                    {t.failure_reason && t.status !== "CONFIRMED" && (
                      <span className="max-w-[60ch] text-[0.75rem] leading-relaxed text-mute">{t.failure_reason}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {t.tx_hash && (
                      <a href={explorerTx(t.tx_hash)} target="_blank" rel="noreferrer" className="text-[0.8125rem] text-sand underline-offset-4 hover:underline">
                        Transaction
                      </a>
                    )}
                    <TransferStatePill status={t.status} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </PageShell>
  );
}
