import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { getWalletBalance } from "@/lib/api/transfers";
import { CannotSend } from "../send-ui";
import { SplitForm } from "./form";

export const metadata = { title: "Split · Tender" };

export const dynamic = "force-dynamic";

/**
 * Splitting one amount across several recipients.
 *
 * The one outbound flow where a silent failure is worst: a partial send that
 * pays two of five recipients leaves the merchant to work out which three are
 * missing, from a screen that said it had sent. So the backend sends every
 * share in a single transaction (Multicall3), and it lands whole or not at all.
 */
export default async function SplitPage() {
  const wallet = await getWalletBalance();
  return (
    <PageShell>
      <PageHeader
        back="/app/pay"
        eyebrow="Pay · Split"
        title="Split a payment"
        description="Divide one amount across several addresses. Everyone is paid together, or nobody is."
        actions={
          <Link
            href="/app/pay"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Back to Pay
          </Link>
        }
      />

      {wallet.ok ? <SplitForm wallet={wallet.data} /> : <CannotSend reason="We could not check your wallet just now. Try again in a moment." />}
    </PageShell>
  );
}
