"use client";

import Link from "next/link";
import {
  MotionConfig,
  motion,
  type Transition,
  type Variants,
} from "motion/react";
import type { ReactNode } from "react";

/**
 * The dashboard's tab rail.
 *
 * Adapted from the Glow Menu component: each tab is a two-faced label that
 * tips over on hover (the front face rotates away on X while the back rotates
 * up into place), a soft radial glow blooms behind the tab, and the whole
 * rail lights faintly while the pointer is on it. The shape is an icon beside
 * a mono label, with the current tab a solid filled block.
 *
 * What changed from the original, and why:
 *   - Tabs are real links (and the Pay tab a real menu button), not buttons
 *     reporting a label to an `onItemClick`. Navigation that only works through
 *     a callback breaks middle-click, prefetch and the screen reader's "link".
 *   - The glows are Tender's sand. The demo shipped one blue, orange, green
 *     and red glow per tab; the dashboard does not use any of those.
 *   - No next-themes, lucide or `cn`: the dashboard is light only, has its
 *     own icon set, and composes classes with template strings.
 *   - The rail's glow lives in its own clipped layer. The original clipped
 *     the whole rail with `overflow-hidden`, which would also have cut off the
 *     Pay dropdown hanging below it.
 *   - Each tab sets `inherit={false}`, so hovering the rail lights the rail
 *     without flipping all seven tabs at once.
 *   - The back face is `aria-hidden`: it is a copy of the front, and a
 *     screen reader should hear each label once.
 *
 * `reducedMotion="user"` drops the rotation for anyone who asked their OS for
 * less motion; the faces then simply cross-fade.
 */

const EASE = [0.4, 0, 0.2, 1] as const;

const frontFace: Variants = {
  initial: { rotateX: 0, opacity: 1 },
  hover: { rotateX: -90, opacity: 0 },
};

const backFace: Variants = {
  initial: { rotateX: 90, opacity: 0 },
  hover: { rotateX: 0, opacity: 1 },
};

const tabGlow: Variants = {
  initial: { opacity: 0, scale: 0.8 },
  hover: {
    opacity: 1,
    scale: 1.7,
    transition: {
      opacity: { duration: 0.5, ease: EASE },
      scale: { type: "spring", stiffness: 300, damping: 25 },
    },
  },
};

const railGlow: Variants = {
  initial: { opacity: 0 },
  hover: { opacity: 1, transition: { duration: 0.5, ease: EASE } },
};

const flip: Transition = { type: "spring", stiffness: 100, damping: 20 };

/** Sand, fading to nothing before the edge so the bloom has no rim. */
const TAB_GLOW =
  "radial-gradient(circle, rgba(196,133,53,0.22) 0%, rgba(196,133,53,0.08) 50%, rgba(196,133,53,0) 70%)";
const RAIL_GLOW =
  "radial-gradient(ellipse at center, transparent 0%, rgba(196,133,53,0.10) 35%, rgba(196,133,53,0.06) 65%, transparent 90%)";

export function GlowRail({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  /** `GlowTab`s, each already wrapped in its `<li>`. */
  children: ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.nav
        aria-label={label}
        initial="initial"
        whileHover="hover"
        className={`relative rounded-2xl border border-line bg-gradient-to-b from-paper to-paper/60 p-1 shadow-[0_6px_20px_-12px_rgba(18,17,17,0.18)] ${className}`}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
        >
          <motion.span
            variants={railGlow}
            className="absolute -inset-2"
            style={{ background: RAIL_GLOW }}
          />
        </span>
        <ul className="relative z-10 flex items-center gap-0.5">{children}</ul>
      </motion.nav>
    </MotionConfig>
  );
}

type TabProps = {
  icon: (props: { className?: string }) => ReactNode;
  label: string;
  /** The current screen: a solid ink block with a standing glow. */
  active: boolean;
  /** Drawn on both faces after the label — the Pay tab's chevron. */
  trailing?: ReactNode;
} & (
  | { href: string; onClick?: never; expanded?: never }
  | { href?: never; onClick: () => void; expanded: boolean }
);

export function GlowTab(props: TabProps) {
  const { icon: Icon, label, active, trailing } = props;

  const face =
    "flex items-center gap-2 whitespace-nowrap rounded-xl px-3.5 py-2 font-mono text-[0.6875rem] uppercase leading-none tracking-[0.12em]";
  const text = active ? "text-paper" : "text-mute";
  const backText = active ? "text-paper" : "text-ink";

  const faces = (
    <>
      <motion.span
        variants={frontFace}
        transition={flip}
        className={`relative z-10 ${face} ${text}`}
        style={{ transformStyle: "preserve-3d", transformOrigin: "center bottom" }}
      >
        <Icon className="h-4 w-4" />
        {label}
        {trailing}
      </motion.span>
      <motion.span
        aria-hidden="true"
        variants={backFace}
        transition={flip}
        className={`absolute inset-0 z-10 ${face} ${backText}`}
        style={{
          transformStyle: "preserve-3d",
          transformOrigin: "center top",
          rotateX: 90,
        }}
      >
        <Icon className="h-4 w-4 text-sand" />
        {label}
        {trailing}
      </motion.span>
    </>
  );

  const hit =
    "relative z-10 block rounded-xl outline-offset-2";

  return (
    <motion.div
      // Its own hover, not the rail's: see the note at the top of the file.
      inherit={false}
      initial="initial"
      whileHover="hover"
      className="relative rounded-xl"
      style={{ perspective: "600px" }}
    >
      <motion.span
        aria-hidden="true"
        variants={tabGlow}
        // The current tab keeps its glow; the others only bloom on hover.
        animate={active ? "hover" : undefined}
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{ background: TAB_GLOW }}
      />
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-0 rounded-xl bg-ink shadow-[0_6px_16px_-8px_rgba(18,17,17,0.55)]"
        />
      )}
      {props.href !== undefined ? (
        <Link
          href={props.href}
          aria-current={active ? "page" : undefined}
          className={hit}
        >
          {faces}
        </Link>
      ) : (
        <button
          type="button"
          onClick={props.onClick}
          aria-expanded={props.expanded}
          aria-haspopup="menu"
          className={hit}
        >
          {faces}
        </button>
      )}
    </motion.div>
  );
}
