"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Cta } from "@/components/dash/cta";
import { CopyValue } from "@/components/dash/copy";
import { EyeIcon, EyeOffIcon } from "@/components/dash/icons";
import { Hash, Money } from "@/components/dash/money";
import type { Amount } from "@/lib/api/types";

/**
 * ⭐ The Home balance card.
 *
 * Every figure on it is passed in from `/v1/merchant/balance`, unchanged. The
 * card decides layout and nothing else: it never sums two assets, never
 * applies a rate, and never shows a currency the API did not send. When the
 * API supplies `display_total` that is the headline; otherwise the headline is
 * the settlement asset's own amount with its ticker beside it.
 *
 * Client-side for one reason only — the hide toggle — and that preference is a
 * per-browser convenience kept in localStorage, so it is read after mount to
 * keep the server render and the first client render identical.
 */

export type BalanceLine = { asset: string; amount: Amount };

export type BalanceCardProps = {
  /** The balance request failed; this is the API's own message. */
  error?: string | null;
  /** `display_total` from the API, when it sends one. */
  total?: { currency: string; amount: Amount } | null;
  settled: BalanceLine[];
  unsettled: BalanceLine[];
  /** `Merchant.settlement_asset`. Picks which settled line is the headline. */
  asset?: string | null;
  address?: string | null;
  /**
   * False when the merchant request failed. Then the address is UNKNOWN, not
   * missing, and the card must not tell the merchant to go and set one.
   */
  addressKnown?: boolean;
  verified: boolean;
  /**
   * Public path of the card art, or null until it is on disk. The art is a
   * stack of gold discs on the right third of a near-black ground, so the card
   * keeps every figure and control in the left column and gives the right side
   * to the stack.
   */
  art?: string | null;
};

const HIDE_KEY = "tender.hide-balance";

/** Shared by the figure and its hidden / error stand-ins so none of them jumps. */
const HERO =
  "font-display text-[clamp(2.75rem,2rem+3.2vw,4.25rem)] leading-none tracking-[-0.035em]";

export default function BalanceCard({
  error,
  total,
  settled,
  unsettled,
  asset,
  address,
  addressKnown = true,
  verified,
  art,
}: BalanceCardProps) {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try {
      setHidden(window.localStorage.getItem(HIDE_KEY) === "1");
    } catch {
      // Private window or blocked storage: the card simply starts visible.
    }
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    try {
      window.localStorage.setItem(HIDE_KEY, next ? "1" : "0");
    } catch {
      // Same as above — the toggle still works for this visit.
    }
  }

  // The headline line: the settlement asset if it has settled anything, else
  // whatever settled first. `others` is everything not shown as the headline.
  const primary =
    settled.find((line) => line.asset === asset) ?? settled[0] ?? null;
  const others = total ? settled : settled.filter((line) => line !== primary);
  const ticker = primary?.asset ?? asset ?? null;

  return (
    <section
      aria-label="Balance"
      className="relative isolate flex h-full min-h-[17.5rem] flex-col overflow-hidden rounded-[1.25rem] bg-ink p-6 text-paper md:min-h-[19rem] md:p-8"
    >
      {art ? (
        // On desktop the art sits in the right 62% of the card, sized by
        // height so the whole stack shows, and its black left edge is masked
        // into the card's ink so there is no seam. On a phone the column IS
        // the card, so the stack drops back to a dim glow behind the figures.
        <div
          aria-hidden="true"
          className="absolute inset-y-0 right-0 -z-20 w-full [mask-image:linear-gradient(90deg,transparent,#000_30%)] md:w-[62%]"
        >
          <Image
            src={art}
            alt=""
            fill
            priority
            sizes="(min-width: 1024px) 30rem, 100vw"
            className="object-cover object-[100%_40%] opacity-30 md:opacity-100"
          />
        </div>
      ) : (
        <FallbackArt />
      )}

      <div className="flex items-center gap-2.5">
        <h2 className="font-mono text-[0.6875rem] uppercase leading-none tracking-[0.24em] text-paper/55">
          Settled on Monad
        </h2>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={hidden}
          aria-label={hidden ? "Show balance" : "Hide balance"}
          className="-m-1.5 rounded-full p-1.5 text-paper/45 transition-colors hover:text-paper"
        >
          {hidden ? (
            <EyeOffIcon className="h-4 w-4" />
          ) : (
            <EyeIcon className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="mt-6 md:max-w-[58%]">
        {error ? (
          <>
            <p className={`${HERO} text-paper/30`}>—</p>
            <p className="mt-3 max-w-[40ch] text-[0.875rem] leading-relaxed text-paper/60">
              Your balance could not be loaded. {error}
            </p>
          </>
        ) : hidden ? (
          <p aria-label="Balance hidden" className={HERO}>
            ••••••
          </p>
        ) : total ? (
          <Money amount={total.amount} currency={total.currency} size="hero" />
        ) : (
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {/* An empty settled list from a successful request IS a zero
                balance — the API said so — which is why a 0 is shown here and
                a dash only on error. */}
            <Money amount={primary?.amount ?? "0"} size="hero" />
            {ticker && (
              <span className="font-mono text-[0.8125rem] uppercase tracking-[0.14em] text-paper/50">
                {ticker}
              </span>
            )}
          </p>
        )}

        {!error && !hidden && <SubLine others={others} unsettled={unsettled} />}
      </div>

      {/* Actions and the address stay in the left column too: on desktop
          the right side is the disc stack, and buttons over gold read as
          stickers, not controls. */}
      <div className="mt-auto flex flex-col gap-4 pt-8 md:max-w-[58%]">
        <div className="flex gap-2">
          <Cta href="/app/checkout/new" tone="paper">
            Get paid
          </Cta>
          <Cta href="/app/pay/payout" tone="ghost">
            Pay out
          </Cta>
        </div>
        {addressKnown && <AddressRow address={address} verified={verified} />}
      </div>
    </section>
  );
}

/** Other settled assets, then money seen on chain but not yet final. */
function SubLine({
  others,
  unsettled,
}: {
  others: BalanceLine[];
  unsettled: BalanceLine[];
}) {
  if (others.length === 0 && unsettled.length === 0) {
    return (
      <p className="mt-3 text-[0.8125rem] text-paper/50">
        <Link
          href="/app/earn"
          className="underline-offset-4 transition-colors hover:text-paper hover:underline"
        >
          Put idle revenue to work &rarr;
        </Link>
      </p>
    );
  }

  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem] text-paper/60">
      {others.map((line) => (
        <li key={`s-${line.asset}`} className="flex items-baseline gap-1.5">
          <Money amount={line.amount} maxDp={8} size="sm" />
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper/45">
            {line.asset}
          </span>
        </li>
      ))}
      {unsettled.map((line) => (
        <li key={`u-${line.asset}`} className="flex items-baseline gap-1.5">
          <span className="text-sand">+</span>
          <Money amount={line.amount} maxDp={8} size="sm" />
          <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper/45">
            {line.asset} on its way
          </span>
        </li>
      ))}
    </ul>
  );
}

function AddressRow({
  address,
  verified,
}: {
  address?: string | null;
  verified: boolean;
}) {
  if (!address) {
    return (
      <Link
        href="/app/settings"
        className="text-[0.8125rem] text-paper/60 underline-offset-4 transition-colors hover:text-paper hover:underline"
      >
        Set where your money lands &rarr;
      </Link>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-paper/40">
        Lands at
      </span>
      <Hash value={address} className="text-paper/80" />
      <CopyValue value={address} tone="ink" />
      {!verified && (
        // An unverified address must not receive money, so the card says so
        // on the address itself, not only in Settings.
        <Link
          href="/app/settings"
          className="rounded-full bg-sand/15 px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-sand transition-colors hover:bg-sand/25"
        >
          Unverified
        </Link>
      )}
    </div>
  );
}

/**
 * The card's ground if `public/img/card.png` is ever missing: a sand glow and a set of concentric
 * rings on the right — many chains closing in on one point. Pure CSS, so the
 * card is finished today and the render only upgrades it.
 */
function FallbackArt() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 -z-20"
      style={{
        backgroundImage: [
          "radial-gradient(60% 85% at 92% 55%, rgba(196,133,53,0.34), transparent 70%)",
          "repeating-radial-gradient(circle at 90% 55%, rgba(240,239,235,0.07) 0 1px, transparent 1px 26px)",
          "linear-gradient(160deg, #1b1918 0%, #121111 55%, #0b0a0a 100%)",
        ].join(","),
      }}
    />
  );
}
