/** Inline glyphs for the pill buttons — Goldsand puts a mark before each label. */

export function KeyIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M9.6 1.4a5 5 0 0 0-4.73 6.62L1.3 11.6a1 1 0 0 0-.3.7v2.3a.4.4 0 0 0 .4.4h2.3a1 1 0 0 0 .7-.3l.9-.9v-1.2h1.3v-1.3h1.2l.87-.87A5 5 0 1 0 9.6 1.4Zm1.5 4.1a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2Z" />
    </svg>
  );
}

/** Stroked rather than filled — it sits beside text, not inside a pill. */
export function ArrowRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />
    </svg>
  );
}

export function DocsIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M3 2.2h6.2L13 6v7.8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.2a1 1 0 0 1 1-1Zm5.7 1.5v2.6H11L8.7 3.7ZM4.6 8.2h6.2v1.2H4.6V8.2Zm0 2.6h4.3V12H4.6v-1.2Z" />
    </svg>
  );
}
