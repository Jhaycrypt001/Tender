import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { getChains } from "@/lib/api/public";
import { CreateInvoiceForm } from "./form";

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

  return (
    <PageShell>
      <PageHeader
        back="/app/checkout"
        eyebrow="Checkout · New"
        title="New invoice"
        description="Set the amount and what you will accept. You get a link to hand the buyer."
        actions={
          <Link
            href="/app/checkout"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Cancel
          </Link>
        }
      />
      <CreateInvoiceForm chains={chains} usingFallback={!result.ok} />
    </PageShell>
  );
}
