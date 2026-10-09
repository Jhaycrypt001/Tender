import { PageShell } from "@/components/dash/shell";

/**
 * Shown the instant a dashboard link is tapped, while the next page is fetched.
 *
 * Every dashboard page reads live data before it can render, so without this a tap
 * on the menu shows nothing at all until the API has answered, which on a phone
 * looks exactly like a dead link.
 */
export default function Loading() {
  return (
    <PageShell>
      <div role="status" aria-label="Loading" className="animate-pulse">
        <div className="mb-3 h-3 w-24 rounded-full bg-stone" />
        <div className="mb-8 h-9 w-2/3 max-w-sm rounded-xl bg-stone" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-40 rounded-2xl bg-stone" />
          <div className="h-40 rounded-2xl bg-stone" />
        </div>
        <div className="mt-4 h-56 rounded-2xl bg-stone" />
      </div>
    </PageShell>
  );
}
