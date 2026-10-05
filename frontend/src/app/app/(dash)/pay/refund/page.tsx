import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { listPayments } from "@/lib/api/payments";
import { getWalletBalance } from "@/lib/api/transfers";
import { RefundForm } from "./form";

export const metadata = { title: "Refund · Tender" };

export const dynamic = "force-dynamic";

/** How many settled payments to offer. Older ones are reached via Activity. */
const LIMIT = 25;

/**
 * Refund a payment.
 *
 * ⚠️ The list is filtered to SETTLED on the wire, not in the browser. Only a
 * settled payment can be refunded: a DETECTED one has not landed yet, a FAILED
 * one never landed, and a REFUNDED one has already gone back. Fetching
 * everything and hiding the rest client-side would ship those rows to the page
 * anyway and leave one devtools edit between a merchant and a request the API
 * will reject.
 */
export default async function RefundPage() {
  const [result, wallet] = await Promise.all([listPayments({ status: "SETTLED", limit: LIMIT }), getWalletBalance()]);

  return (
    <PageShell>
      <PageHeader
        back="/app/pay"
        eyebrow="Pay · Refund"
        title="Refund a payment"
        description="Return a settled payment to the buyer who made it."
        actions={
          <Link
            href="/app/activity"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            All activity
          </Link>
        }
      />

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.data.length === 0 ? (
        <Card tone="quiet">
          <p className="text-[0.9375rem] leading-relaxed">
            No settled payments to refund.
          </p>
          <p className="mt-3 max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
            A payment can only be refunded once it has settled. Payments still
            arriving, and ones that already failed, are not refundable — you
            can see where each one stands in{" "}
            <Link
              href="/app/activity"
              className="text-ink underline decoration-sand underline-offset-4"
            >
              Activity
            </Link>
            .
          </p>
        </Card>
      ) : (
        <RefundForm payments={result.data.data} wallet={wallet.ok ? wallet.data : { can_send: false, reason: "We could not check your wallet just now. Try again in a moment." }} />
      )}
    </PageShell>
  );
}
