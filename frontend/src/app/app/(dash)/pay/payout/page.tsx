import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";

export const metadata = { title: "Payout · Tender" };

/**
 * Paying someone who is not a buyer.
 *
 * ⚠️ Deliberately NOT built as a form. There is no payout endpoint in the §5
 * contract — no route, no type, nothing. A screen with an amount field, a
 * destination field and a Send button would look finished and do nothing, and
 * the failure would land at the worst possible moment: after the merchant
 * believes they have paid a supplier.
 *
 * The plan sets this precedent for Ramps in as many words — "Do not fake a
 * bank payout" — and the same reasoning applies here. An honest unbuilt state
 * reads as unfinished. A fake one reads as finished until it costs someone.
 */
export default function PayoutPage() {
  return (
    <PageShell>
      <PageHeader
        back="/app/pay"
        eyebrow="Pay · Payout"
        title="Pay someone"
        description="Send settled revenue to a supplier, a contractor or your own wallet."
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
          Payouts need an API endpoint that does not exist yet. Rather than
          show a form that collects an amount and a destination and then has
          nowhere to send them, this screen waits.
        </p>
        <p className="mt-4 max-w-[60ch] text-[0.875rem] leading-relaxed text-mute">
          What you can do today: money that has settled is already in your own
          wallet on Monad, at the settlement address in{" "}
          <Link
            href="/app/settings"
            className="text-ink underline decoration-sand underline-offset-4"
          >
            Settings
          </Link>
          . Paying out from there works now, with whatever wallet you already
          use.
        </p>
        <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
          When it lands: amount, destination and chain, paid from settled
          revenue with the balance checked first.
        </p>
      </Card>
    </PageShell>
  );
}
