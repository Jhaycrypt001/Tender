"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { ArrowLeftIcon } from "@/components/dash/icons";
import { canGoBack } from "@/lib/nav-history";

/**
 * Back, the way a phone app does it.
 *
 * If the merchant got here by tapping around the dashboard, it steps back to
 * exactly where they were — same filter, same scroll. If they landed here
 * cold (a shared link, a reload), there is nothing in the app to go back to,
 * so it goes to the screen's parent instead: an invoice goes to Checkout, a
 * refund to Pay.
 *
 * It is a real link to that parent underneath, so it works before hydration,
 * opens in a new tab on a middle-click, and is announced as a link.
 */
export default function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Leave modified clicks alone: those are "open the parent elsewhere".
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!canGoBack()) return;
    event.preventDefault();
    router.back();
  }

  return (
    <Link
      href={fallback}
      onClick={onClick}
      className="group mb-5 inline-flex h-9 items-center gap-2 rounded-full border border-line bg-paper pl-1 pr-3.5 text-[0.8125rem] text-ink transition-colors hover:border-ink/25"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-stone transition-colors group-hover:bg-ink group-hover:text-paper">
        <ArrowLeftIcon className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      </span>
      Back
    </Link>
  );
}
