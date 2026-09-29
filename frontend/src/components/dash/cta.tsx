import Link from "next/link";

/**
 * The dashboard's call-to-action link.
 *
 * Square-cornered, mono caps, registration marks on the corners — the one
 * button shape every screen's primary move uses, so "the thing to do next"
 * looks the same on Home, Checkout and an empty list alike.
 *
 * It is a `Link` because a CTA here always navigates. Anything that writes goes
 * through `Submit` in action.tsx, which shares these classes via `CTA_CLASS`.
 */

type Tone = "ink" | "outline" | "paper" | "ghost";

const TONE: Record<Tone, string> = {
  ink: "bg-ink text-paper hover:bg-ink/88",
  outline: "border border-line bg-paper text-ink hover:border-ink/35",
  // For use on ink surfaces — the balance card — where `ink` would vanish.
  paper: "bg-paper text-ink hover:bg-paper/88",
  ghost: "border border-paper/25 text-paper hover:border-paper/55",
};

export const CTA_CLASS =
  "crosshairs relative inline-flex items-center justify-center gap-2 rounded-[0.625rem] px-4 py-2.5 font-mono text-[0.6875rem] uppercase leading-none tracking-[0.14em] transition-colors";

export function Cta({
  href,
  children,
  tone = "ink",
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link href={href} className={`${CTA_CLASS} ${TONE[tone]} ${className}`}>
      {children}
    </Link>
  );
}
