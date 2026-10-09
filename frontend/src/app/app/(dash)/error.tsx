"use client";

import { useEffect } from "react";
import { reloadIfStale } from "@/lib/stale-deploy";
import Link from "next/link";
import { PageShell } from "@/components/dash/shell";
import { Card } from "@/components/dash/card";
import { Action } from "@/components/dash/action";

/**
 * When one dashboard page fails to render: usually the API was slow, down, or said
 * something unexpected. The header and menu stay, because they belong to the layout,
 * so the merchant can try again or simply go somewhere else.
 *
 * Nothing about money is implied: a page failing to load says nothing about whether
 * a payment arrived, so the copy does not guess.
 */
export default function DashError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // A tab left over from before a deploy: reload onto the new one instead of showing this page.
    if (reloadIfStale(error)) return;
    console.error("[tender] dashboard page failed", error);
  }, [error]);

  return (
    <PageShell>
      <Card tone="quiet">
        <div role="alert" className="flex flex-col gap-4">
          <p className="font-display text-[1.75rem] leading-none tracking-[-0.02em]">This page didn&rsquo;t load.</p>
          <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-mute">
            Something went wrong on our side. Your money and payments are not affected. Try again, or open another page.
          </p>
          <div className="flex flex-wrap gap-2">
            <Action variant="primary" onClick={reset}>
              Try again
            </Action>
            <Link href="/app/home" className="inline-flex items-center rounded-full border border-line px-4 py-2 text-[0.875rem] text-ink hover:bg-stone">
              Go to Home
            </Link>
          </div>
          {error.digest && <p className="font-mono text-[0.6875rem] text-mute">Reference: {error.digest}</p>}
        </div>
      </Card>
    </PageShell>
  );
}
