import { useId } from "react";
import "./mascot.css";

/**
 * Tender's assistant mascot: a glossy sand drop with ink eyes and a sparkle
 * antenna. Pure SVG, so it is sharp from the 26px nav button up to the
 * 132px intro.
 *
 * `mood="happy"` swaps the eyes for ^ ^ arcs, opens the mouth into a grin and
 * blushes the cheeks; `look="right"` turns the face toward where it is going.
 * Both are CSS transitions (mascot.css, `tm-` classes), so changing the prop is
 * all a caller does. Calm eyes blink on their own.
 */
export function Mascot({
  mood = "calm",
  look = "ahead",
  className = "",
}: {
  mood?: "calm" | "happy";
  look?: "ahead" | "right";
  className?: string;
}) {
  // useId can contain characters that break a url(#…) reference.
  const id = `tm${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <svg
      viewBox="0 0 120 120"
      className={`tm ${className}`}
      data-mood={mood}
      data-look={look}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <radialGradient id={`${id}-body`} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="#f6cf92" />
          <stop offset="0.42" stopColor="#d99b4f" />
          <stop offset="0.78" stopColor="#b77a33" />
          <stop offset="1" stopColor="#8e5a1e" />
        </radialGradient>
        <radialGradient id={`${id}-rim`} cx="50%" cy="50%" r="50%">
          <stop offset="0.82" stopColor="#8e5a1e" stopOpacity="0" />
          <stop offset="1" stopColor="#6e4416" stopOpacity="0.35" />
        </radialGradient>
      </defs>

      {/* antenna */}
      <path d="M60 22V13" stroke="#121111" strokeWidth="3" strokeLinecap="round" />
      <path
        className="tm-star"
        d="M60 1.5l2.1 5.2 5.2 2.1-5.2 2.1-2.1 5.2-2.1-5.2-5.2-2.1 5.2-2.1z"
        fill="#c48535"
        stroke="#121111"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />

      {/* body */}
      <path
        d="M60 18C94 18 112 38 112 68C112 98 92 114 60 114C28 114 8 98 8 68C8 38 26 18 60 18Z"
        fill={`url(#${id}-body)`}
      />
      <path
        d="M60 18C94 18 112 38 112 68C112 98 92 114 60 114C28 114 8 98 8 68C8 38 26 18 60 18Z"
        fill={`url(#${id}-rim)`}
      />
      {/* gloss */}
      <ellipse cx="38" cy="38" rx="15" ry="8" fill="#fff" opacity="0.5" transform="rotate(-26 38 38)" />
      <circle cx="24" cy="54" r="3" fill="#fff" opacity="0.42" />

      <g className="tm-face">
        <g className="tm-eyes-calm">
          <ellipse cx="45" cy="64" rx="6.5" ry="9" fill="#121111" />
          <ellipse cx="75" cy="64" rx="6.5" ry="9" fill="#121111" />
          <circle cx="47.6" cy="60" r="2.3" fill="#fff" />
          <circle cx="77.6" cy="60" r="2.3" fill="#fff" />
        </g>
        <g
          className="tm-eyes-happy"
          stroke="#121111"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        >
          <path d="M37.5 67Q45 55 52.5 67" />
          <path d="M67.5 67Q75 55 82.5 67" />
        </g>

        <ellipse className="tm-cheek" cx="33" cy="80" rx="7" ry="4.5" fill="#e8846a" />
        <ellipse className="tm-cheek" cx="87" cy="80" rx="7" ry="4.5" fill="#e8846a" />

        <path
          className="tm-mouth-calm"
          d="M53 83Q60 89 67 83"
          stroke="#121111"
          strokeWidth="3.5"
          fill="none"
          strokeLinecap="round"
        />
        <g className="tm-mouth-happy">
          <path d="M46 78Q60 80.5 74 78Q72.5 98 60 98Q47.5 98 46 78Z" fill="#121111" />
          <path d="M51.5 92Q60 86 68.5 92Q65.5 98 60 98Q54.5 98 51.5 92Z" fill="#e0715a" />
        </g>
      </g>
    </svg>
  );
}
