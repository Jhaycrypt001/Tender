"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Money } from "@/components/dash/money";
import { DISPLAY_CURRENCIES } from "@/lib/dash-nav";
import { convertUsd, displayDecimals, isUsdPegged } from "@/lib/fx";
import type { Amount } from "@/lib/api/types";

/**
 * The display currency: which currency the dashboard SHOWS dollar amounts in.
 *
 * ⚠️ Presentation only. It is not the settlement asset and it changes nothing
 * about where money goes. The choice is remembered in a cookie (not
 * localStorage) so the server renders the first paint in the right currency,
 * with no flash of dollars before the browser corrects it.
 */

export const CURRENCY_COOKIE = "tender_currency";

type CurrencyState = {
  /** The chosen code. USD whenever the choice has no rate to back it. */
  code: string;
  setCode: (code: string) => void;
  /** Codes that can actually be shown: USD, plus every one with a live rate. */
  available: ReadonlySet<string>;
  rates: Record<string, string>;
  /** When the rates were published, or null when there are none. */
  asOf: string | null;
  /** What the merchant's payments settle in (USDC, USDT0, MON). */
  settlementAsset: string;
};

const Ctx = createContext<CurrencyState>({
  code: "USD",
  setCode: () => {},
  available: new Set(["USD"]),
  rates: {},
  asOf: null,
  settlementAsset: "USDC",
});

export const useCurrency = () => useContext(Ctx);

export function CurrencyProvider({
  initial,
  rates,
  asOf,
  settlementAsset,
  children,
}: {
  initial: string;
  rates: Record<string, string>;
  asOf: string | null;
  settlementAsset: string;
  children: React.ReactNode;
}) {
  const available = useMemo(() => new Set(["USD", ...Object.keys(rates)]), [rates]);
  const [chosen, setChosen] = useState(initial);
  // A saved choice whose rate has gone away falls back to dollars rather than
  // showing a converted-looking number with no rate behind it.
  const code = available.has(chosen) ? chosen : "USD";

  const setCode = useCallback(
    (next: string) => {
      if (!available.has(next)) return;
      setChosen(next);
      try {
        document.cookie = `${CURRENCY_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
      } catch {
        // The choice still applies for this visit; it just will not be remembered.
      }
    },
    [available],
  );

  const value = useMemo(
    () => ({ code, setCode, available, rates, asOf, settlementAsset }),
    [code, setCode, available, rates, asOf, settlementAsset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * A dollar-valued amount, shown in the chosen display currency.
 *
 * `currency` is what the amount is ACTUALLY in (an invoice's currency, say).
 * Left out, it is the merchant's settlement asset. If that is a dollar-pegged
 * one and a rate exists, the figure is converted and labelled with the display
 * currency's code. Otherwise it renders exactly as before, in its own unit:
 * a MON amount, or any amount while USD is chosen, is never relabelled.
 */
export function FiatMoney({
  amount,
  currency,
  size,
  maxDp,
  className,
}: {
  amount: Amount;
  currency?: string;
  size?: "sm" | "md" | "lg" | "xl" | "hero";
  maxDp?: number;
  className?: string;
}) {
  const { code, rates, settlementAsset } = useCurrency();
  const source = currency ?? settlementAsset;

  if (code !== "USD" && isUsdPegged(source) && rates[code]) {
    const converted = convertUsd(amount, rates[code], displayDecimals(code));
    if (converted !== null) {
      return <Money amount={converted} currency={code} size={size} maxDp={displayDecimals(code)} className={className} />;
    }
  }
  return <Money amount={amount} currency={currency} size={size} maxDp={maxDp} className={className} />;
}

/** The entry for a code, for the selector. */
export const currencyMeta = (code: string) => DISPLAY_CURRENCIES.find((c) => c.code === code) ?? DISPLAY_CURRENCIES[0];
