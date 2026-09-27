import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Empty, ErrorState } from "@/components/dash/empty";
import { Money, Timestamp } from "@/components/dash/money";
import { InvoiceStatePill } from "@/components/dash/state-pill";
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
    <Link
      href="/app/checkout/new"
      className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-[0.875rem] text-paper transition-colors hover:bg-ink/90"
    >
      New invoice
    </Link>
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
        eyebrow="Get paid"
        title="Checkout"
        description="Create an invoice, hand the buyer a link, and watch it settle."
        actions={<NewInvoiceButton />}
      />

      {/* Filters render whether or not the request succeeded: they are
          navigation, and hiding them behind a failed fetch would make the
          screen look broken rather than empty. */}
      <nav aria-label="Filter invoices" className="mb-5 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const on = f.label === active.label;
          return (
            <Link
              key={f.label}
              href={f.status ? `/app/checkout?status=${f.status}` : "/app/checkout"}
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
                  <Money amount={inv.amount_expected} currency={inv.currency} />
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
