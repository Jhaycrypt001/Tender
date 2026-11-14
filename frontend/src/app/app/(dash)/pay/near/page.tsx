import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { getWalletBalance } from "@/lib/api/transfers";
import { CannotSend } from "../send-ui";
import { NearForm } from "./form";

export const metadata = { title: "Pay to NEAR · Tender" };

export const dynamic = "force-dynamic";

/**
 * Paying a NEAR account, carried by NEAR Intents.
 *
 * Tender calls NEAR Intents directly for the quote, the one-off deposit address and the delivery
 * tracking (this is separate from the Aurora-backed payouts). The merchant's own wallet signs a
 * transfer to that address; Tender relays it and pays the network fee, and never holds the money.
 * See `near-transfer.service.ts` in the backend.
 */
export default async function NearPayoutPage() {
  const wallet = await getWalletBalance();
  return (
    <PageShell>
      <PageHeader
        back="/app/pay"
        eyebrow="Pay · NEAR"
        title="Pay a NEAR account"
        description="Send USDC straight to a NEAR account. NEAR Intents carries it and tracks it to the end."
        actions={
          <Link href="/app/pay" className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline">
            Back to Pay
          </Link>
        }
      />

      {wallet.ok ? <NearForm wallet={wallet.data} /> : <CannotSend reason="We could not check your wallet just now. Try again in a moment." />}
    </PageShell>
  );
}
