import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Empty, ErrorState } from "@/components/dash/empty";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { listPayments } from "@/lib/api/payments";
import { chainLabel } from "@/lib/chains";
import type { ListPaymentsQuery } from "@/lib/api/types";

export const metadata = { title: "Activity · Tender" };

export const dynamic = "force-dynamic";

/**
 * The filters.
 *
 * ⚠️ These deliberately mix two different enums. "Paid" and "Failed" are
 * PAYMENT states, but "Needs recovery" is an INVOICE state — there is no
 * NEEDS_RECOVERY payment status, because the payment itself succeeded and it
 * is the onward settlement that did not. Sending that pill as `status` would
 * quietly return nothing, so each filter names which field it queries.
 */
const FILTERS: { label: string; query: ListPaymentsQuery }[] = [
  { label: "All", query: {} },
  { label: "Paid", query: { status: "SETTLED" } },
  { label: "Seen on chain", query: { status: "DETECTED" } },
  { label: "Needs recovery", query: { invoice_status: "NEEDS_RECOVERY" } },
  { label: "Refunded", query: { status: "REFUNDED" } },
];

/** The slug that appears in the URL, so a filtered view is linkable. */
function slug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const active = FILTERS.find((f) => slug(f.label) === filter) ?? FILTERS[0];

  const result = await listPayments(active.query);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Ledger"
        title="Activity"
        description="Every payment across every invoice, and the state it reached."
      />

      {/* Rendered regardless of the result: these are navigation, and hiding
          them behind a failed fetch makes the screen look broken, not empty. */}
      <nav aria-label="Filter payments" className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const on = f.label === active.label;
          const href =
            f.label === "All" ? "/app/activity" : `/app/activity?filter=${slug(f.label)}`;
          return (
            <Link
              key={f.label}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`rounded-full border px-3.5 py-1.5 text-[0.8125rem] transition-colors ${
                on
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paper text-mute hover:border-mute/50 hover:text-ink"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.data.length === 0 ? (
        <Empty
          title={
            active.label === "All"
              ? "No activity yet"
              : `Nothing ${active.label.toLowerCase()}`
          }
          description={
            active.label === "All"
              ? "Payments appear here the moment a buyer's deposit is seen on chain — before it has settled."
              : "No payments are in this state right now."
          }
          action={
            active.label === "All" ? (
              <Link
                href="/app/checkout/new"
                className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-[0.875rem] text-paper transition-colors hover:bg-ink/90"
              >
                New invoice
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={[
            { key: "when", label: "First seen" },
            { key: "from", label: "From" },
            { key: "sent", label: "Sent", align: "right" },
            { key: "settled", label: "Settled", align: "right" },
            { key: "tx", label: "Transaction", secondary: true },
            { key: "state", label: "State", align: "right" },
          ]}
          rows={result.data.data.map(
            (p): Row => ({
              id: p.id,
              href: `/app/activity/${p.id}`,
              cells: {
                when: <Timestamp value={p.first_seen_at} />,
                from: chainLabel(p.from_chain),
                /**
                 * ⚠️ `amount_in` is in the SOURCE asset (BTC, SOL…), not the
                 * settlement currency, so it carries no currency prop and gets
                 * 8 decimal places. Labelling 0.00042 BTC as "USDC" would be a
                 * lie about what the buyer sent.
                 */
                sent: <Money amount={p.amount_in} maxDp={8} />,
                settled: p.amount_settled ? (
                  <Money amount={p.amount_settled} />
                ) : null,
                tx: <Hash value={p.tx_hash} />,
                state: <PaymentStatePill status={p.status} />,
              },
            }),
          )}
          empty="No payments."
          caption="Payments"
        />
      )}
    </PageShell>
  );
}
