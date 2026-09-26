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
    <div className={`mx-auto w-full max-w-[76rem] px-4 py-7 md:px-6 md:py-9 ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2.5 text-mute">{eyebrow}</p>}
        <h1 className="font-display text-[1.75rem] leading-[1.1] tracking-[-0.02em] md:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-[44ch] text-[0.9375rem] leading-relaxed text-mute">
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
