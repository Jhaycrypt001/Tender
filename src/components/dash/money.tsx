import type { Amount } from "@/lib/api/types";

/**
 * Rendering money.
 *
 * ⚠️ THE RULE: an `Amount` is a decimal string and is never converted to a
 * number anywhere in this file. `Number("1234567890123456789")` silently loses
 * the low digits — an 18-decimal on-chain value does not survive a float, and
 * the failure is invisible, which is the worst kind. Everything below is string
 * manipulation on purpose. It looks like more work than `toFixed()`; that is
 * the point.
 *
 * `Intl.NumberFormat` is not used for the same reason: it takes a number.
 * Grouping is done by hand on the integer digits.
 */

/** Inserts thousands separators into a run of digits. String in, string out. */
function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Splits a decimal string into display parts without arithmetic.
 *
 * Returns the sign, the grouped integer part, and the fraction trimmed to
 * `maxDp` — truncated, never rounded. Rounding a payment up would show a
 * merchant a figure they were not paid.
 */
function parts(amount: Amount, maxDp: number) {
  const negative = amount.trim().startsWith("-");
  const clean = amount.trim().replace(/^[+-]/, "");
  const [rawInt = "0", rawFrac = ""] = clean.split(".");

  const int = group(rawInt.replace(/^0+(?=\d)/, "") || "0");
  const frac = rawFrac.slice(0, maxDp).replace(/0+$/, "");

  return { negative, int, frac };
}

/**
 * An amount, with the fraction set smaller than the integer.
 *
 * The de-emphasised decimals are what make a column of figures scannable —
 * the eye lands on the magnitude first. Tabular numerals keep the columns
 * aligned when several of these stack in a table.
 */
export function Money({
  amount,
  currency,
  /** Crypto needs more places than fiat; the caller knows which this is. */
  maxDp = 2,
  size = "md",
  className = "",
}: {
  amount: Amount;
  /** A ticker or symbol. Rendered as given — this component never converts. */
  currency?: string;
  maxDp?: number;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const { negative, int, frac } = parts(amount, maxDp);

  const SIZE = {
    sm: "text-[0.875rem]",
    md: "text-[1rem]",
    lg: "font-display text-[1.75rem] tracking-[-0.02em]",
    xl: "font-display text-[2.5rem] leading-none tracking-[-0.03em]",
  } as const;

  return (
    <span className={`tabular-nums ${SIZE[size]} ${className}`}>
      {negative && "-"}
      {currency && (
        <span className="mr-1 font-mono text-[0.75em] text-mute">
          {currency}
        </span>
      )}
      {int}
      {/* `break-all` on the fraction ONLY. The integer part must never break —
          a wrapped "1,234,/567" is unreadable as money — but an 18-decimal
          crypto fraction is long enough to overflow a phone, so it may wrap. */}
      {frac && (
        <span className="break-all text-[0.72em] opacity-55">.{frac}</span>
      )}
    </span>
  );
}

/**
 * A truncated hash or address, with the middle elided.
 *
 * Always shows both ends: the leading characters identify the chain's address
 * format and the trailing ones are what a merchant actually compares against a
 * block explorer. Truncating only the tail would make two addresses from the
 * same wallet look identical.
 */
export function Hash({
  value,
  lead = 6,
  tail = 4,
  className = "",
}: {
  value: string;
  lead?: number;
  tail?: number;
  className?: string;
}) {
  const short =
    value.length <= lead + tail + 1
      ? value
      : `${value.slice(0, lead)}…${value.slice(-tail)}`;

  return (
    <span
      // The full value in the title, so hovering answers "which address is
      // this?" without a round trip to the detail page.
      title={value}
      className={`font-mono text-[0.8125rem] ${className}`}
    >
      {short}
    </span>
  );
}

/**
 * A timestamp, rendered on the server without a locale guess.
 *
 * `toLocaleString()` would produce a different string on the server than in
 * the browser and trip a hydration mismatch, so the format is fixed and
 * explicit. UTC, because a merchant reconciling against a block explorer is
 * reading UTC there too.
 */
export function Timestamp({
  value,
  /** Date only, for grouping rows by day. */
  dateOnly = false,
  className = "",
}: {
  value: string;
  dateOnly?: boolean;
  className?: string;
}) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return <span className={`text-mute ${className}`}>&mdash;</span>;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const date = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;

  return (
    <span className={`tabular-nums text-[0.8125rem] ${className}`}>
      {dateOnly ? date : `${date}, ${time}`}
    </span>
  );
}
