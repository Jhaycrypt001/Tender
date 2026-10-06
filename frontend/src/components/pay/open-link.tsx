"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Money } from "@/components/dash/money";
import Unavailable from "@/components/pay/unavailable";
import { openPaymentLink } from "@/lib/api/public";
import type { PublicLink } from "@/lib/api/types";

/** Plain decimal, up to 8 places. The backend re-checks; this only saves a round trip. */
const AMOUNT = /^\d{1,12}(\.\d{1,8})?$/;

/**
 * A reusable payment link, at /pay/pl_…
 *
 * A link is not an invoice. Opening one asks the backend to mint a fresh
 * invoice for this buyer, then hands over to the ordinary checkout at
 * /pay/chk_…. Three rules shape this component:
 *
 *   - ⚠️ Nothing is created on page load. WhatsApp, Telegram, Slack and iMessage
 *     all fetch a URL to draw its preview; if loading the page opened the link,
 *     every chat a merchant pasted it into would leave behind an invoice nobody
 *     asked for. The buyer taps Continue — a POST a crawler never makes.
 *   - ⚠️ The call goes from the BROWSER, not a server action. The backend limits
 *     opening a link to 10 a minute per IP; routed through our server, every
 *     buyer on earth would share our server's IP and that one allowance.
 *   - `router.replace`, not `push`: Back from the checkout must not land here
 *     again and invite a second tap, which would mint a second invoice.
 *
 * `preview` is the link as the buyer may see it (who is paid, for what, how
 * much), read on the server before render. With it, the page names the seller
 * and the amount before the buyer taps anything, and an open-amount link shows
 * its amount field (with the currency) straight away. Without it (the read
 * failed), the page still works the old way: it asks without an amount first,
 * and a field error on `amount` is the signal to ask the buyer for one.
 */
export default function OpenLink({
  token,
  preview = null,
}: {
  token: string;
  preview?: PublicLink | null;
}) {
  const router = useRouter();
  const [needsAmount, setNeedsAmount] = useState(preview ? preview.amount === null : false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);

  async function open(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;

    const value = amount.trim();
    if (needsAmount && (!AMOUNT.test(value) || Number(value) <= 0)) {
      setError("Enter an amount above zero, like 25.00.");
      return;
    }

    setBusy(true);
    setError("");
    const result = await openPaymentLink(token, needsAmount ? value : undefined);

    if (result.ok) {
      // Stay busy: the button must not come back to life mid-navigation.
      router.replace(`/pay/${encodeURIComponent(result.data.token)}`);
      return;
    }
    setBusy(false);

    const { kind, fields } = result.error;
    if (kind === "not_found") {
      setGone(true);
    } else if (kind === "validation" && fields?.amount) {
      if (needsAmount) setError("That amount was not accepted. Enter an amount above zero, like 25.00.");
      // First ask came back wanting an amount: this is an open-amount link.
      // Expected, not an error, so nothing is shown but the new field.
      setNeedsAmount(true);
    } else if (kind === "rate_limited") {
      setError("Too many tries from this network. Wait a minute and try again.");
    } else {
      setError("We could not open this payment just now. Nothing was taken — try again in a moment.");
    }
  }

  if (gone) return <Unavailable kind="not_found" />;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[28rem] flex-col justify-center px-5 py-12">
      {preview ? (
        <>
          <p className="eyebrow text-mute">Pay {preview.merchant_name}</p>
          <h1 className="mt-4 font-display text-[2rem] leading-[1.05] tracking-[-0.03em] md:text-[2.5rem]">
            {preview.label}
          </h1>
          <div className="mt-5">
            {preview.amount ? (
              <Money amount={preview.amount} currency={preview.currency} size="xl" />
            ) : (
              <p className="text-[0.9375rem] leading-relaxed text-mute">
                You choose the amount, in {preview.currency}.
              </p>
            )}
          </div>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-mute">
            Pay with the coin you already hold: Bitcoin, Solana, a stablecoin.
            Pick it on the next screen. No bridging and no swapping.
            Nothing moves until you send.
          </p>
        </>
      ) : (
        <>
          <p className="eyebrow text-mute">Payment link</p>
          <h1 className="mt-4 font-display text-[2rem] leading-[1.05] tracking-[-0.03em] md:text-[2.5rem]">
            Pay with the coin you already hold.
          </h1>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-mute">
            Bitcoin, Solana, a stablecoin: pick what is in your wallet on the next
            screen and send it. No bridging and no swapping. Nothing
            moves until you send.
          </p>
        </>
      )}

      <form onSubmit={open} className="mt-8" noValidate>
        {needsAmount && (
          <div className="mb-4">
            <label htmlFor="link-amount" className="eyebrow text-mute">
              Amount{preview ? ` (${preview.currency})` : ""}
            </label>
            <input
              id="link-amount"
              name="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              inputMode="decimal"
              autoComplete="off"
              autoFocus
              placeholder="0.00"
              aria-describedby="link-amount-help"
              className="mt-2.5 h-14 w-full rounded-xl border border-line bg-paper px-4 font-mono text-[1.25rem] tracking-[0.02em] text-ink placeholder:text-mute/60 focus:border-ink focus:outline-none"
            />
            <p id="link-amount-help" className="mt-2 text-[0.8125rem] leading-relaxed text-mute">
              Enter what the seller asked for. The next screen shows the exact
              total and currency before you send anything.
            </p>
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-12 w-full items-center justify-center rounded-full bg-ink px-6 font-mono text-[0.75rem] uppercase tracking-[0.14em] text-paper transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {busy ? "Opening checkout…" : "Continue to payment"}
        </button>

        {error && (
          <p role="alert" className="mt-3 text-[0.875rem] leading-relaxed text-ink">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
