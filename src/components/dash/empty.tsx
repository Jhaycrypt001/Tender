import type { ApiError, ApiErrorKind } from "@/lib/api/types";

/**
 * ⭐ The most-seen component in the app.
 *
 * Because nothing in this product is mocked, every screen renders one of these
 * until the backend answers — which makes this the difference between the app
 * reading as FINISHED and reading as BROKEN. A screen with a considered empty
 * state looks like a product waiting for its first customer. The same screen
 * with a blank panel looks like a bug.
 *
 * Three states live here rather than in three files because they are the same
 * shape and differ only in tone, and keeping them together is what stops one
 * of them from being forgotten on a new screen.
 */

function Frame({
  children,
  /** Dashed border says "nothing here yet" without needing a word for it. */
  dashed = true,
}: {
  children: React.ReactNode;
  dashed?: boolean;
}) {
  return (
    <div
      className={`flex flex-col items-center rounded-2xl border bg-paper px-5 py-12 text-center md:py-16 ${
        dashed ? "border-dashed border-line" : "border-line"
      }`}
    >
      <div className="max-w-[34ch]">{children}</div>
    </div>
  );
}

/**
 * Nothing here yet — and that is the normal, correct state.
 *
 * Note it takes an `action`: an empty list is the best possible moment to tell
 * someone what to do next, and an empty state without a way out is a dead end.
 */
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Frame>
      <h3 className="font-display text-[1.25rem] leading-tight tracking-[-0.01em]">
        {title}
      </h3>
      <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-mute">
        {description}
      </p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </Frame>
  );
}

/**
 * Something went wrong, said in the merchant's terms.
 *
 * ⚠️ `not_configured` is handled first and separately. Today it is the state
 * every screen is in, because the backend does not exist yet — and it is not a
 * failure, so it must not be dressed as one. A merchant seeing a red "Error"
 * on a product that is simply not connected yet loses trust in the parts that
 * do work.
 */
export function ErrorState({
  error,
  /** A server action or a link that re-runs the request. */
  retry,
}: {
  error: ApiError;
  retry?: React.ReactNode;
}) {
  if (error.kind === "not_configured") {
    return (
      <Frame>
        <p className="eyebrow mb-3 justify-center text-mute">Not connected</p>
        <h3 className="font-display text-[1.25rem] leading-tight tracking-[-0.01em]">
          This screen has no data source yet
        </h3>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-mute">
          The Tender API is not configured for this environment. Everything
          here is built and waiting — set{" "}
          <code className="font-mono text-[0.8125rem] text-ink">
            TENDER_API_URL
          </code>{" "}
          and it fills in.
        </p>
      </Frame>
    );
  }

  // Keyed to the real union minus the kind handled above, so a new error kind
  // in the contract fails to compile here rather than falling through to a
  // generic message a merchant cannot act on.
  const COPY: Record<
    Exclude<ApiErrorKind, "not_configured">,
    { title: string; body: string }
  > = {
    network: {
      title: "Could not reach the API",
      body: "The request did not complete. This is usually a connection problem rather than anything wrong with your account.",
    },
    unauthorized: {
      title: "Your session is not valid",
      body: "Sign out and back in. If it keeps happening, the API key for this environment may have been rotated.",
    },
    not_found: {
      title: "Not found",
      body: "This record does not exist, or it belongs to a different account.",
    },
    validation: {
      title: "That request was rejected",
      body: "The API did not accept these values. Check the fields below and try again.",
    },
    rate_limited: {
      title: "Too many requests",
      body: "You have hit the rate limit for this API key. Wait a moment and try again.",
    },
    server: {
      title: "The API returned an error",
      body: "Something failed on our side, not yours. Nothing was charged and nothing was lost.",
    },
    unknown: {
      title: "Something went wrong",
      body: "The request did not complete.",
    },
  };

  const copy = COPY[error.kind];

  return (
    <Frame dashed={false}>
      <p className="eyebrow mb-3 justify-center text-mute">Error</p>
      <h3 className="font-display text-[1.25rem] leading-tight tracking-[-0.01em]">
        {copy.title}
      </h3>
      <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-mute">
        {copy.body}
      </p>
      {/* The raw message, small. A merchant will paste this into a support
          thread, and hiding it entirely just costs a round trip. */}
      {error.message && (
        <p className="mt-4 font-mono text-[0.75rem] leading-relaxed text-mute/70">
          {error.message}
        </p>
      )}
      {retry && <div className="mt-6 flex justify-center">{retry}</div>}
    </Frame>
  );
}

/**
 * The loading state.
 *
 * Skeleton rows rather than a spinner, because these screens are lists and a
 * skeleton keeps the layout from jumping when the data lands. Marked
 * `aria-hidden` with a live-region label: a screen reader should hear "Loading"
 * once, not read out eight fake rows.
 */
export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <>
      <span className="sr-only" role="status">
        Loading
      </span>
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-[4.25rem] animate-pulse rounded-xl border border-line bg-paper"
            // Stagger, so the rows do not pulse as one block.
            style={{ animationDelay: `${i * 90}ms` }}
          />
        ))}
      </div>
    </>
  );
}
