import type { ReactNode } from "react";

/**
 * A card with light running round its edge.
 *
 * Adapted from the Animated Glow Card component. The markup is theirs — a
 * canvas holding a hidden SVG filter and a backdrop, and a card whose four
 * edges are separate strips — but the component shipped without its CSS, so
 * the motion is Tender's own, in `globals.css` under "Glow card":
 *
 *   - One sand comet travels the edge clockwise: across the top, down the
 *     right, back along the bottom, up the left. Four strips, one keyframe
 *     timeline, phased with negative delays so it reads as a single light.
 *   - Each strip carries a blurred copy of itself through `#unopaq`, which
 *     multiplies alpha by 3. A plain blur fades to nothing a few pixels out;
 *     boosting the alpha turns that fade into a solid-looking halo, which is
 *     what makes the line glow rather than smear.
 *   - The backdrop is a slow-breathing sand bloom behind the card.
 *
 * Under `prefers-reduced-motion` the comet and the breathing stop and the
 * card keeps a still sand hairline.
 *
 * ⚠️ `#unopaq` is a document-wide id. Render ONE `CardCanvas` per page, or
 * lift the `<svg>` out, before using this twice on the same screen.
 */

export function CardCanvas({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`card-canvas ${className}`}>
      <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
        <filter width="3000%" x="-1000%" height="3000%" y="-1000%" id="unopaq">
          <feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 3 0" />
        </filter>
      </svg>
      <div aria-hidden="true" className="card-backdrop" />
      {children}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glow-card ${className}`}>
      <div aria-hidden="true" className="border-element border-left" />
      <div aria-hidden="true" className="border-element border-right" />
      <div aria-hidden="true" className="border-element border-top" />
      <div aria-hidden="true" className="border-element border-bottom" />
      <div className="card-content">{children}</div>
    </div>
  );
}

export default CardCanvas;
