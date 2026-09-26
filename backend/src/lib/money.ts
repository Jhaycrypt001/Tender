import { Decimal } from "decimal.js";

/**
 * All money arithmetic goes through here. Never `Number`, never `parseFloat`:
 * an 18-decimal on-chain amount does not survive a float.
 */
Decimal.set({ precision: 60, rounding: Decimal.ROUND_DOWN });

export { Decimal };

/** A non-negative base-10 decimal string, e.g. "49.00" or "0.000461". */
export const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,18})?$/;

export function isAmount(s: string): boolean {
  return AMOUNT_PATTERN.test(s);
}

/** Converts an on-chain integer amount in base units to a decimal string. */
export function fromBaseUnits(raw: string, decimals: number): string {
  if (!/^\d+$/.test(raw)) throw new Error(`Not a base-unit integer: ${raw}`);
  return new Decimal(raw).div(new Decimal(10).pow(decimals)).toFixed();
}

export type Coverage = "EXACT" | "UNDER" | "OVER";

/** How a received amount compares with what the invoice expects. */
export function coverage(received: string, expected: string): Coverage {
  const cmp = new Decimal(received).cmp(new Decimal(expected));
  return cmp === 0 ? "EXACT" : cmp < 0 ? "UNDER" : "OVER";
}
