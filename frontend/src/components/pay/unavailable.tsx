/**
 * What a buyer sees when a payment cannot be loaded or opened.
 *
 * Written for someone who has never heard of Tender and is holding a link that
 * did not work. It never shows an error code, never mentions an API, and always
 * answers the only question they have: has my money gone anywhere? It has not —
 * this page is reached before any payment is possible.
 */
export default function Unavailable({ kind }: { kind: string }) {
  if (kind === "link_inactive") {
    // The link exists, but the seller switched it off. Distinct from "not
    // valid": the buyer did nothing wrong and the seller is the one to ask.
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col items-center justify-center px-5 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-line bg-paper">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-mute" />
        </div>
        <h1 className="mt-7 font-display text-[1.75rem] leading-tight tracking-[-0.02em]">
          This payment link was turned off
        </h1>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-mute">
          The seller is no longer taking payments through this link. Nothing was
          sent and nothing was taken. Ask them for a new link.
        </p>
      </div>
    );
  }

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
