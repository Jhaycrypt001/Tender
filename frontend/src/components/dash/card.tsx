/**
 * The dashboard's surface.
 *
 * Everything in the app that is not a page background sits on one of these.
 * There is deliberately one card rather than a set of variants: a second card
 * component is how a design system starts drifting, and the two knobs here
 * (`tone`, `pad`) cover every use in the seven screens without inventing more.
 *
 * `tone="ink"` exists for the one or two blocks that need to carry weight —
 * the settled-balance figure, the buyer's payment panel. It is the same card,
 * inverted, not a different component.
 */

type Tone = "paper" | "ink" | "quiet";
type Pad = "none" | "sm" | "md" | "lg";

const TONE: Record<Tone, string> = {
  // The default: white on the stone page background, hairline border.
  paper: "bg-paper border-line text-ink",
  // Inverted. Border is a lightened ink rather than `--line`, which would
  // read as a bright seam against the dark fill.
  ink: "bg-ink border-paper/12 text-paper",
  // Same white as `paper` but borderless — for cards that sit inside another
  // card, where a second hairline would read as a double rule.
  quiet: "bg-paper border-transparent text-ink",
};

const PAD: Record<Pad, string> = {
  none: "",
  sm: "p-3.5",
  md: "p-4 md:p-5",
  lg: "p-5 md:p-7",
};

export function Card({
  children,
  tone = "paper",
  pad = "md",
  className = "",
  /** Draws registration marks on the corners. Used sparingly —
   *  on a block that is the point of the screen, not on every card. */
  marks = false,
}: {
  children: React.ReactNode;
  tone?: Tone;
  pad?: Pad;
  className?: string;
  marks?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl border ${TONE[tone]} ${PAD[pad]} ${
        marks ? "crosshairs" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A card's own heading row.
 *
 * Separate from `SectionHeader` in shell.tsx because that one labels a region
 * of the page and sits on the page background; this one sits inside a card and
 * has to align to the card's padding.
 */
export function CardHeader({
  label,
  hint,
  action,
}: {
  label: string;
  /** One short line under the label. Not a tooltip — always visible. */
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="eyebrow text-mute">{label}</h3>
        {hint && (
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-mute">
            {hint}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
