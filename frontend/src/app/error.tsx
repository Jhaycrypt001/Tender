"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/stale-deploy";
import Button from "@/components/button";

/**
 * When a page outside the dashboard fails to render: the site, sign-in, or a buyer's
 * pay page. A buyer may be mid-payment, so the copy tells them what matters: nothing
 * they already sent is lost, and reloading is safe.
 */
export default function SiteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // A tab left over from before a deploy: reload onto the new one instead of showing this page.
    if (reloadIfStale(error)) return;
    console.error("[tender] page failed", error);
  }, [error]);

  return (
    <section className="flex min-h-[70vh] items-center justify-center px-6 py-32">
      <div role="alert" className="text-center">
        <p className="font-display text-2xl text-sand">Error</p>
        <h1 className="mt-4 text-balance">Something went wrong</h1>
        <p className="mx-auto mt-5 max-w-[46ch] text-pretty text-ink/70">
          This page didn&rsquo;t load. If you were paying, anything you already sent is safe. Try again in a moment.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-[0.875rem] font-medium text-paper transition-colors hover:bg-ink/85"
          >
            Try again
          </button>
          <Button href="/" variant="ghost">
            Back to home
          </Button>
        </div>
        {error.digest && <p className="mt-6 font-mono text-[0.6875rem] text-ink/50">Reference: {error.digest}</p>}
      </div>
    </section>
  );
}
