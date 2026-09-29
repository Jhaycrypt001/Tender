/**
 * Dashboard iconography.
 *
 * Kept apart from `src/components/icons.tsx` because that file serves the
 * marketing site and is bundled with it; these ship only inside `/app`.
 *
 * All of them are 24×24, 1.5-weight strokes on `currentColor`, drawn open
 * rather than filled. The nav renders the same glyph in both states and lets
 * colour carry the active/inactive distinction, so a filled variant would be
 * a second thing to keep in sync for no gain.
 */

type IconProps = { className?: string };

function Svg({ className = "", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Back — a plain arrow pointing the way you came. */
export function ArrowLeftIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M19 12H5.5M11 5.5 4.5 12l6.5 6.5" />
    </Svg>
  );
}

/** Home — a roof over a doorway. */
export function HomeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 10.5 12 4l8.5 6.5V19a1 1 0 0 1-1 1h-4v-5h-7v5h-4a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

/** Pay — money leaving: an arrow out of a wallet. */
export function PayIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 8.5V7a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5" />
      <path d="M13 12h8" />
      <path d="m18 9 3 3-3 3" />
    </Svg>
  );
}

/** Earn — a rising line, money at work. */
export function EarnIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 19h16" />
      <path d="m5 15 4-4 3 3 6-7" />
      <path d="M18 7h-3.5M18 7v3.5" />
    </Svg>
  );
}

/** Checkout — a tag with an eyelet: the thing a buyer is handed. */
export function CheckoutIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M11.5 3.5H19a1.5 1.5 0 0 1 1.5 1.5v7.5a1 1 0 0 1-.3.7l-7 7a1 1 0 0 1-1.4 0l-7.5-7.5a1 1 0 0 1 0-1.4l7-7a1 1 0 0 1 .7-.3z" />
      <circle cx="16" cy="8" r="1.25" />
    </Svg>
  );
}

/** Activity — a pulse, the ledger moving. */
export function ActivityIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 12h4l2.5-6 4 13L16 12h5" />
    </Svg>
  );
}

/** Links — two chain links. */
export function LinkIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.54 3.54 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.54 3.54 0 0 0 5 5l1.5-1.5" />
    </Svg>
  );
}

/** Ramps — crypto crossing to a bank building. */
export function RampsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 10v8M19 10v8M9.5 10v8M14.5 10v8" />
      <path d="M3 20h18" />
    </Svg>
  );
}

/** Settings — a gear, simplified to six teeth so it stays legible at 18px. */
export function SettingsIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M4.2 7.5l2.2 1.25M17.6 15.25l2.2 1.25M4.2 16.5l2.2-1.25M17.6 8.75l2.2-1.25" />
    </Svg>
  );
}

/** Ask — a question in a bubble. */
export function AskIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M20 12a8 8 0 1 1-3.2-6.4" />
      <path d="M12 20.2 8 21l.8-3.4" />
      <path d="M10.4 9.6a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.8.6-.8 1.2v.3" />
      <path d="M12 15.8h.01" />
    </Svg>
  );
}

/** Chevron, for dropdowns. */
export function ChevronDownIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m6 9.5 6 6 6-6" />
    </Svg>
  );
}

/** Hamburger, for the mobile nav. */
export function MenuIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

/** Close. */
export function CloseIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/** Copy — two stacked sheets. */
export function CopyIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M15 5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15" />
    </Svg>
  );
}

/** Tick, for confirmations. */
export function CheckIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Svg>
  );
}

/** Plus, for create actions. */
export function PlusIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

/** Eye and eye-off, for the balance toggle. */
export function EyeIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </Svg>
  );
}

export function EyeOffIcon(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4.5 20 20" />
      <path d="M9.9 6A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9" />
      <path d="M6.4 8.1A16.8 16.8 0 0 0 2.5 12S6 18.5 12 18.5a9.5 9.5 0 0 0 3.6-.7" />
      <path d="M10.1 10.1a2.75 2.75 0 0 0 3.8 3.8" />
    </Svg>
  );
}
