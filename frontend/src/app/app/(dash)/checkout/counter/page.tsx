import { PageHeader, PageShell } from "@/components/dash/shell";
import { APP_URL } from "@/lib/auth";
import { Counter } from "./counter";

export const metadata = { title: "Counter · Tender" };

/**
 * Take a payment in person.
 *
 * The page is a thin server wrapper so the public app URL — which the QR and
 * the NFC sticker both point at — comes from server config, the same source
 * the invoice page builds its pay link from. A QR built from the browser's own
 * origin would point a customer at localhost during a demo on a laptop.
 */
export default function CounterPage() {
  return (
    <PageShell>
      <PageHeader
        back="/app/checkout"
        eyebrow="Checkout · Counter"
        title="Take payment in person."
        description="Key in the amount and turn the screen round. The customer scans the code, or taps an NFC sticker, and pays from their own phone."
      />
      <Counter appUrl={APP_URL} />
    </PageShell>
  );
}
