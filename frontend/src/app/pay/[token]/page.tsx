import type { Metadata } from "next";
import Checkout from "@/components/pay/checkout";
import OpenLink from "@/components/pay/open-link";
import Unavailable from "@/components/pay/unavailable";
import { getPublicInvoice, invoiceEventsUrl } from "@/lib/api/public";

/**
 * The buyer checkout, at /pay/<token>.
 *
 * Public: no session, no wallet, no sign-in. It sits OUTSIDE /app on purpose —
 * /app carries the dashboard's auth guard and chrome, and neither belongs in
 * front of a stranger who was handed a payment link.
 *
 * The URL carries the `chk_` token rather than the `inv_` id, because the id is
 * enumerable and merchant-private. A token is the only thing safe to put in a
 * link that gets forwarded, screenshotted and pasted into chat.
 *
 * The same route also serves reusable payment links (`pl_`), which is what the
 * dashboard's Links page shares. A link is not an invoice yet: `OpenLink` asks
 * the buyer to continue, mints one, and replaces the URL with its `chk_` token.
 */

/** Backend link token shape. Checked here so a mangled link fails without a request. */
const LINK_TOKEN = /^pl_[0-9A-Za-z]{27}$/;

// Always fresh: an invoice's status is the entire point of the page, and a
// cached "awaiting payment" shown to someone who has already paid is the worst
// possible output.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pay",
  // A payment link should never be indexed — it is a one-off, private URL.
  robots: { index: false, follow: false },
};

export default async function PayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (token.startsWith("pl_")) {
    if (!LINK_TOKEN.test(token)) return <Unavailable kind="not_found" />;
    return <OpenLink token={token} />;
  }

  const result = await getPublicInvoice(token);

  if (!result.ok) {
    return <Unavailable kind={result.error.kind} />;
  }

  return (
    <Checkout invoice={result.data} eventsUrl={invoiceEventsUrl(token)} />
  );
}
