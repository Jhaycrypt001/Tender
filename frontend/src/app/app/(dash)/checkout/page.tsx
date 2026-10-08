import { LiveRefresh } from "@/components/dash/live-refresh";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Empty, ErrorState } from "@/components/dash/empty";
import { CheckoutIcon, PlusIcon } from "@/components/dash/icons";
import { Cta } from "@/components/dash/cta";
import { Timestamp } from "@/components/dash/money";
import { FiatMoney } from "@/components/dash/currency";
import { InvoiceStatePill } from "@/components/dash/state-pill";
import { FilterTabs } from "@/components/dash/filter-tabs";
import { DataTable, type Row } from "@/components/dash/table";
import { listInvoices } from "@/lib/api/invoices";
import type { Invoice } from "@/lib/api/types";

export const metadata = { title: "Checkout · Tender" };

export const dynamic = "force-dynamic";

/** The filters a merchant actually reaches for, in the order they need them. */
/**
 * Merchant-facing groups, not raw states. An invoice that was paid a little
 * over or under, or is still confirming, belongs under a group a merchant
 * would look in, so every invoice is in exactly one tab besides All.
 */
const GROUPS = {
  open: { label: "Awaiting payment", has: (i: Invoice, now: number) => i.status === "DETECTED" || (i.status === "PENDING" && Date.parse(i.expires_at) > now) },
  paid: { label: "Paid", has: (i: Invoice) => i.status === "SETTLED" || i.status === "OVERPAID" },
  attention: { label: "Needs attention", has: (i: Invoice) => i.status === "UNDERPAID" || i.status === "NEEDS_RECOVERY" },
  closed: { label: "Closed", has: (i: Invoice, now: number) => i.status === "EXPIRED" || i.status === "CANCELLED" || (i.status === "PENDING" && Date.parse(i.expires_at) <= now) },
} as const;
type GroupKey = keyof typeof GROUPS;

const FILTERS: { label: string; group?: GroupKey }[] = [
  { label: "All" },
  ...(Object.keys(GROUPS) as GroupKey[]).map((group) => ({ label: GROUPS[group].label, group })),
];

function NewInvoiceButton() {
  return (
    <Cta href="/app/checkout/new">
      <PlusIcon className="h-3.5 w-3.5" />
      New invoice
    </Cta>
  );
}

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const active = FILTERS.find((f) => f.group === view) ?? FILTERS[0];

  const all = await listInvoices({ limit: 100 });
  const now = Date.now();
  const result = all.ok
    ? { ok: true as const, data: { ...all.data, data: active.group ? all.data.data.filter((i) => GROUPS[active.group!].has(i, now)) : all.data.data } }
    : all;

  return (
    <PageShell>
      <LiveRefresh />
      <PageHeader
        back="/app/home"
        eyebrow="Checkout"
        title="Bill anyone. Any chain."
        description="Create an invoice. Share the link."
        actions={
          <>
            {/* In person: the customer scans or taps at the till. */}
            <Cta href="/app/checkout/counter" tone="outline">
              Counter
            </Cta>
            <NewInvoiceButton />
          </>
        }
      />

      {/* Filters render whether or not the request succeeded: they are
          navigation, and hiding them behind a failed fetch would make the
          screen look broken rather than empty. */}
      {/* A segmented control, not loose pills: these are mutually exclusive
          views of one list, and a single track says so at a glance. */}
      <FilterTabs
        label="Filter invoices"
        tabs={FILTERS.map((f) => ({
          label: f.label,
          href: f.group ? `/app/checkout?view=${f.group}` : "/app/checkout",
          on: f.label === active.label,
        }))}
      />

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.data.length === 0 ? (
        <Empty
          icon={<CheckoutIcon className="h-5 w-5" />}
          title={
            active.group
              ? `No ${active.label.toLowerCase()} invoices`
              : "No invoices yet"
          }
          description={
            active.group
              ? "Nothing here."
              : "Create one and share the link."
          }
          action={active.group ? undefined : <NewInvoiceButton />}
        />
      ) : (
        <DataTable
          columns={[
            { key: "reference", label: "Reference" },
            { key: "amount", label: "Amount", align: "right" },
            { key: "created", label: "Created", secondary: true },
            { key: "expires", label: "Expires", secondary: true },
            { key: "state", label: "State", align: "right" },
          ]}
          rows={result.data.data.map(
            (inv): Row => ({
              id: inv.id,
              href: `/app/checkout/${inv.id}`,
              cells: {
                reference: inv.reference,
                amount: (
                  <FiatMoney amount={inv.amount_expected} currency={inv.currency} />
                ),
                created: <Timestamp value={inv.created_at} dateOnly />,
                expires: <Timestamp value={inv.expires_at} />,
                state: <InvoiceStatePill status={inv.status} />,
              },
            }),
          )}
          empty="No invoices."
          caption="Invoices"
        />
      )}
    </PageShell>
  );
}
