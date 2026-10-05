import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { getWalletBalance } from "@/lib/api/transfers";
import { CannotSend } from "../send-ui";
import { PayoutForm } from "./form";

export const metadata = { title: "Payout · Tender" };

export const dynamic = "force-dynamic";

/**
 * Paying someone who is not a buyer.
 *
 * Money that has settled is already in the merchant's own wallet, so a payout
 * is that wallet signing a transfer. Tender plans it, relays the signature and
 * pays the network fee; it never holds the money and cannot send anything the
 * wallet did not sign. See `transfer.service.ts` in the backend.
 */
export default async function PayoutPage() {
  const wallet = await getWalletBalance();
  return (
    <PageShell>
      <PageHeader
        back="/app/pay"
        eyebrow="Pay · Payout"
        title="Pay someone"
        description="Send settled revenue to a supplier or a contractor."
        actions={
          <Link
            href="/app/pay"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Back to Pay
          </Link>
        }
      />

      {wallet.ok ? <PayoutForm wallet={wallet.data} /> : <CannotSend reason="We could not check your wallet just now. Try again in a moment." />}
    </PageShell>
  );
}
