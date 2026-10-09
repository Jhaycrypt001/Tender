import Link from "next/link";

export type FilterTab = { label: string; href: string; on: boolean };

/**
 * The segmented filter track above a list (Activity, Checkout).
 *
 * Three things keep it inside the page:
 *   - One line that scrolls sideways, never wraps. Five labels wrapped onto
 *     two ragged rows on a phone and pushed the list down by a row's height
 *     every time the set changed.
 *   - `scroll={false}`: changing the filter swaps the list under the track,
 *     it does not throw the merchant back to the top of the screen.
 *   - `replace`: a filter is a view of this screen, not a new screen, so it
 *     must not stack history entries — otherwise Back would step through
 *     every filter tapped before it ever left the page.
 */
export function FilterTabs({
  label,
  tabs,
}: {
  label: string;
  tabs: FilterTab[];
}) {
  return (
    <nav aria-label={label} className="mb-5 max-w-full">
      {/* On a phone the tabs outrun the screen. The scrollbar is hidden, so the right edge
          fades out instead: a cut-off word under a fade reads as "swipe for more". */}
      <div className="no-scrollbar inline-flex max-w-full gap-1 overflow-x-auto overscroll-x-contain rounded-xl border border-line bg-paper p-1 [mask-image:linear-gradient(to_right,black_85%,transparent)] md:[mask-image:none]">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            scroll={false}
            replace
            aria-current={t.on ? "page" : undefined}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[0.8125rem] transition-colors ${
              t.on ? "bg-ink text-paper" : "text-mute hover:bg-stone hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
