import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { getChains } from "@/lib/api/public";
import { CreateInvoiceForm, type ChainListState } from "./form";

export const metadata = { title: "New invoice · Tender" };

// The chain list comes from the API, so this cannot be prerendered.
export const dynamic = "force-dynamic";

/**
 * Create an invoice.
 *
 * The chain list is fetched here on the server rather than in the form,
 * because a merchant should see the real minimums when they exist — and when
 * they do not, the form says so instead of inventing numbers.
 */
export default async function NewInvoicePage() {
  const result = await getChains();

  const chains = result.ok
    ? result.data.map((c) => ({
        id: c.id,
        name: c.name,
        minimum: c.minimum,
      }))
    : [];

  // Why there may be no live list. A 503 is the backend saying it has not
  // measured minimums yet (after a cold start, or while a destination chain is
  // in maintenance on Aurora's side). That is "not yet", not a failure, and
  // invoices can still be created.
  const listState: ChainListState = result.ok
    ? chains.length > 0
      ? "live"
      : "measuring"
    : result.error.kind === "not_configured"
      ? "not_connected"
      : result.error.status === 503
        ? "measuring"
        : "unavailable";

  return (
    <PageShell>
      <PageHeader
        back="/app/checkout"
        eyebrow="Checkout · New"
        title="New invoice"
        description="Set an amount, get a link."
        actions={
          <Link
            href="/app/checkout"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Cancel
          </Link>
        }
      />
      <CreateInvoiceForm chains={chains} listState={listState} />
    </PageShell>
  );
}
