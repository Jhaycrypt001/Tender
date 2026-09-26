import type { Metadata } from "next";
import Checkout from "@/components/pay/checkout";
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
 */

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
  const result = await getPublicInvoice(token);

  if (!result.ok) {
    return <Unavailable kind={result.error.kind} />;
  }

  return (
    <Checkout invoice={result.data} eventsUrl={invoiceEventsUrl(token)} />
  );
}

/**
 * What a buyer sees when the invoice cannot be loaded.
 *
 * Written for someone who has never heard of Tender and is holding a link that
 * did not work. It never shows an error code, never mentions an API, and always
 * answers the only question they have: has my money gone anywhere? It has not —
 * this page is reached before any payment is possible.
 */
function Unavailable({ kind }: { kind: string }) {
  const notFound = kind === "not_found";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col items-center justify-center px-5 py-12 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-paper">
        <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-mute" />
      </div>

      <h1 className="mt-7 font-display text-[1.75rem] leading-tight tracking-[-0.02em]">
        {notFound ? "This payment link is not valid" : "This page is not available right now"}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-mute">
        {notFound
          ? "The link may have been mistyped, or the seller may have cancelled it. Nothing was sent and nothing was taken — ask the seller for a new link."
          : "We could not load this payment. Nothing was sent and nothing was taken. Try again in a moment, or ask the seller for a new link."}
      </p>
    </div>
  );
}
