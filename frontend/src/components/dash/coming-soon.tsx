import { Card } from "@/components/dash/card";

/**
 * A notice at the top of a screen whose feature is not switched on yet.
 *
 * The screen underneath stays exactly as built: this only says, before anyone
 * reads on, that nothing below is live. It promises no date and no number, so
 * nothing here can turn out to be wrong.
 */
export function ComingSoonNotice({ children }: { children: React.ReactNode }) {
  return (
    <Card tone="quiet" className="mb-6">
      <div role="note" className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded-full border border-sand px-2.5 py-1 font-mono text-[0.6875rem] uppercase leading-none tracking-[0.1em] text-sand">
          Coming soon
        </span>
        <p className="text-[0.9375rem] leading-relaxed">{children}</p>
      </div>
    </Card>
  );
}

/** The small tag beside a nav item whose feature is not live yet. */
export function SoonTag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-line px-1.5 py-[0.1875rem] font-mono text-[0.5625rem] uppercase leading-none tracking-[0.1em] text-mute ${className}`}
    >
      Soon
    </span>
  );
}
