import { PageHeader, PageShell } from "@/components/dash/shell";
import { Empty, ErrorState } from "@/components/dash/empty";
import { ActivityIcon, PlusIcon } from "@/components/dash/icons";
import { Cta } from "@/components/dash/cta";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { FiatMoney } from "@/components/dash/currency";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { FilterTabs } from "@/components/dash/filter-tabs";
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
        back="/app/home"
        eyebrow="Activity"
        title="Every coin, accounted for."
        description="Every payment across every invoice, and the state it reached."
      />

      {/* Rendered regardless of the result: these are navigation, and hiding
          them behind a failed fetch makes the screen look broken, not empty. */}
      <FilterTabs
        label="Filter payments"
        tabs={FILTERS.map((f) => ({
          label: f.label,
          href:
            f.label === "All"
              ? "/app/activity"
              : `/app/activity?filter=${slug(f.label)}`,
          on: f.label === active.label,
        }))}
      />

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.data.length === 0 ? (
        <Empty
          icon={<ActivityIcon className="h-5 w-5" />}
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
              <Cta href="/app/checkout/new">
                <PlusIcon className="h-3.5 w-3.5" />
                New invoice
              </Cta>
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
                  <FiatMoney amount={p.amount_settled} />
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
