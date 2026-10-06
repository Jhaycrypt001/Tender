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
import type { InvoiceStatus } from "@/lib/api/types";

export const metadata = { title: "Checkout · Tender" };

export const dynamic = "force-dynamic";

/** The filters a merchant actually reaches for, in the order they need them. */
const FILTERS: { label: string; status?: InvoiceStatus }[] = [
  { label: "All" },
  { label: "Awaiting payment", status: "PENDING" },
  { label: "Settled", status: "SETTLED" },
  { label: "Needs recovery", status: "NEEDS_RECOVERY" },
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
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = FILTERS.find((f) => f.status === status) ?? FILTERS[0];

  const result = await listInvoices(
    active.status ? { status: active.status } : {},
  );

  return (
    <PageShell>
      <PageHeader
        back="/app/home"
        eyebrow="Checkout"
        title="Bill anyone. Any chain."
        description="Create an invoice, hand the buyer a link, and watch it settle."
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
          href: f.status ? `/app/checkout?status=${f.status}` : "/app/checkout",
          on: f.label === active.label,
        }))}
      />

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.data.length === 0 ? (
        <Empty
          icon={<CheckoutIcon className="h-5 w-5" />}
          title={
            active.status
              ? `No ${active.label.toLowerCase()} invoices`
              : "No invoices yet"
          }
          description={
            active.status
              ? "Nothing matches this filter right now."
              : "Create one and you get a link to hand your buyer. They can pay from any chain you accept."
          }
          action={active.status ? undefined : <NewInvoiceButton />}
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
