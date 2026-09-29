import BackButton from "@/components/dash/back-button";

/**
 * The page frame inside the dashboard: a titled header and a content column.
 *
 * Kept separate from the nav so a screen can opt out of the standard heading
 * (the buyer-facing checkout, for one) without inheriting a title block it
 * does not want.
 */

export function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Width and centring come from the railed frame in (dash)/layout.tsx, so
    // the rails and the content column can never disagree about where the
    // edge is.
    <div className={`w-full px-4 py-7 md:px-8 md:py-10 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  back,
  eyebrow,
  title,
  description,
  actions,
}: {
  /**
   * Where Back goes when there is no in-app history to step through — the
   * screen's logical parent. Omit it on Home, which has no parent.
   */
  back?: string;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col gap-5 sm:mb-9 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <div>
            <BackButton fallback={back} />
          </div>
        )}
        {eyebrow && <p className="eyebrow mb-3.5 text-mute">{eyebrow}</p>}
        {/* A statement, not a label: each screen opens by saying what it is
            for in one short line, then the dim sub says how. */}
        <h1 className="font-display text-[clamp(2rem,1.45rem+2.3vw,2.875rem)] leading-[1.04] tracking-[-0.025em]">
          {title}
        </h1>
        {description && (
          <p className="mt-3 max-w-[48ch] text-[0.9375rem] leading-relaxed text-mute">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A section heading inside a page, with an optional trailing control.
 * Uses the mono eyebrow rather than another display face so it sits clearly
 * below the page title in the hierarchy.
 */
export function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <h2 className="eyebrow text-mute">{label}</h2>
      {action}
    </div>
  );
}

/**
 * A registration mark: the small + where a rail meets a rule.
 *
 * Drawn from two hairlines rather than a glyph, so it lands on the pixel grid
 * exactly and matches the 1px rails it marks. Positioned by the caller, which
 * knows which corner it sits on.
 */
export function FrameMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 hidden h-[0.8125rem] w-[0.8125rem] md:block ${className}`}
    >
      <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-mute/70" />
      <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-mute/70" />
    </span>
  );
}
