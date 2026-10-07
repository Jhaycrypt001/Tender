"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** How often the page re-reads its data while the tab is in front. */
const INTERVAL_MS = 12_000;

/**
 * Keeps a server-rendered dashboard page current without a manual reload.
 *
 * The pages it sits on are `force-dynamic` and read from the API on the server,
 * so re-running them with `router.refresh()` is enough: no data is duplicated on
 * the client and the page keeps its scroll position and any filters in the URL.
 *
 * It only polls while the tab is visible, refreshes once when the tab comes back
 * into view, and never starts a refresh while the previous one is still running,
 * so a slow API cannot pile requests up.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [, tick] = useState(0);

  useEffect(() => {
    busy.current = pending;
    if (!pending) setUpdatedAt(Date.now());
  }, [pending]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible" || busy.current) return;
      startTransition(() => router.refresh());
    };
    const poll = setInterval(refresh, INTERVAL_MS);
    // Redraw the "updated … ago" text between refreshes.
    const clock = setInterval(() => tick((n) => n + 1), 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (updatedAt === null) return null;
  const secs = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
  const label =
    secs < 10 ? "just now" : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;

  return (
    <p
      aria-live="off"
      className="mb-3 flex items-center justify-end gap-2 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-mute"
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-sand"
      />
      Live · updated {label}
    </p>
  );
}
