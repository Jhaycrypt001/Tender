/**
 * Showing a dollar amount in another currency. PRESENTATION ONLY.
 *
 * ⚠️ Same rule as `components/dash/money.tsx`: an amount is a decimal string and
 * never passes through a float. The conversion below is integer arithmetic on
 * BigInt, truncating (never rounding up) to the display currency's decimals.
 * A merchant must not be shown a figure larger than what the rate gives.
 *
 * Only amounts that are ALREADY dollars are converted: USD itself and the
 * dollar-pegged settlement assets. A MON balance is not converted: that would
 * need MON's price, which this feed does not carry, and guessing it would put a
 * wrong number on the screen. Nothing the buyer SENT (`amount_in`, in whatever
 * coin they paid with) is ever converted either.
 */

/** Settlement assets and invoice currencies worth one US dollar each. */
const USD_PEGGED = new Set(["USD", "USDC", "USDT", "USDT0"]);

export function isUsdPegged(code: string | undefined | null): boolean {
  return !!code && USD_PEGGED.has(code.toUpperCase());
}

/** Places an amount of this currency is shown with. */
export function displayDecimals(code: string): number {
  return code === "JPY" ? 0 : 2;
}

const DP_AMOUNT = 18;

/** "123.45" -> [12345n, 2]: digits as a BigInt and how many of them are fraction. */
function toScaled(value: string): { n: bigint; scale: number } | null {
  const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) return null;
  const frac = m[3] ?? "";
  const n = BigInt(m[2]! + frac);
  return { n: m[1] ? -n : n, scale: frac.length };
}

/**
 * `amount` (a US-dollar decimal string) times `rate` (units of the display
 * currency per dollar), as a decimal string with exactly `dp` places, truncated
 * toward zero. Null if either input is not a plain decimal, so a bad rate
 * shows the original amount rather than a wrong one.
 */
export function convertUsd(amount: string, rate: string, dp: number): string | null {
  const a = toScaled(amount);
  const r = toScaled(rate);
  if (!a || !r || r.n <= BigInt(0)) return null;
  // Cap the fraction we keep of the amount, like Money does: more than 18 places is not money.
  const aScale = Math.min(a.scale, DP_AMOUNT);
  const aN = a.scale > DP_AMOUNT ? a.n / BigInt(10) ** BigInt(a.scale - DP_AMOUNT) : a.n;

  // value = aN * r.n / 10^(aScale + r.scale); we want it in units of 10^-dp.
  const shift = aScale + r.scale - dp;
  const product = aN * r.n;
  const out = shift >= 0 ? product / BigInt(10) ** BigInt(shift) : product * BigInt(10) ** BigInt(-shift);

  const negative = out < BigInt(0);
  const digits = (negative ? -out : out).toString().padStart(dp + 1, "0");
  const whole = digits.slice(0, digits.length - dp);
  const frac = dp > 0 ? `.${digits.slice(digits.length - dp)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}
