import {
  AE,
  AU,
  BR,
  CA,
  CH,
  EU,
  GB,
  IN,
  JP,
  NG,
  SG,
  US,
  ZA,
} from "country-flag-icons/react/1x1";
import type { DisplayCurrency } from "@/lib/dash-nav";

/**
 * The flag beside each display currency.
 *
 * SVG, not emoji: Windows ships no flag glyphs, so a regional-indicator emoji
 * renders there as two bare letters ("US") — on the very machines a lot of
 * merchants run. The square 1x1 set is clipped to a circle so every flag reads
 * at the same weight regardless of its real proportions.
 */
const FLAGS: Record<DisplayCurrency["code"], typeof US> = {
  USD: US,
  EUR: EU,
  GBP: GB,
  NGN: NG,
  JPY: JP,
  CAD: CA,
  AUD: AU,
  CHF: CH,
  INR: IN,
  BRL: BR,
  ZAR: ZA,
  AED: AE,
  SGD: SG,
};

export default function CurrencyFlag({
  code,
  className = "h-[1.125rem] w-[1.125rem]",
}: {
  code: DisplayCurrency["code"];
  className?: string;
}) {
  const Flag = FLAGS[code];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-ink/10 ${className}`}
    >
      <Flag className="h-full w-full" />
    </span>
  );
}
