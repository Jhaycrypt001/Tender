/**
 * Whole-unit arithmetic for the tokens a merchant sends (USDC and USDT0 both
 * have 6 decimals), so no amount here ever passes through a float.
 *
 * Same rule as `components/dash/money.tsx`: an amount is a decimal string and
 * never a `Number`. Everything is truncated toward zero, never rounded up, so a
 * figure computed here can only ever be at most what is really there.
 */

const MICRO = BigInt(1_000_000);

/** "12.5" -> 12500000n. Extra decimals are dropped. Null if it is not a plain non-negative decimal. */
export function toMicro(value: string): bigint | null {
  const m = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!m) return null;
  return BigInt(m[1]!) * MICRO + BigInt(((m[2] ?? "") + "000000").slice(0, 6));
}

/** 12500000n -> "12.5". */
export function fromMicro(value: bigint): string {
  const whole = value / MICRO;
  const frac = (value % MICRO).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
