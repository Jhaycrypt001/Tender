import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";

export const metadata = { title: "Split · Tender" };

/**
 * Splitting one amount across several recipients.
 *
 * ⚠️ Not built, for the same reason as Payout: there is no endpoint. A split
 * is additionally the one outbound flow where a silent failure is worst — a
 * partial send that pays two of five recipients leaves the merchant to work
 * out which three are missing, from a screen that told them it had sent.
 */
export default function SplitPage() {
  return (
    <PageShell>
      <PageHeader
        back="/app/pay"
        eyebrow="Pay · Split"
        title="Split a payment"
        description="Divide one amount across several addresses in a single flow."
        actions={
          <Link
            href="/app/pay"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Back to Pay
          </Link>
        }
      />

      <Card tone="quiet">
        <CardHeader label="Not available yet" />
        <p className="max-w-[60ch] text-[0.9375rem] leading-relaxed">
          Splits need an API endpoint that does not exist yet. A split that
          half-succeeds is worse than one that never started, so this ships
          when the backend can send every share or none of them.
        </p>
        <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
          When it lands: recipients with a share each, by percentage or amount,
          checked to total the whole before anything sends.
        </p>
      </Card>
    </PageShell>
  );
}
