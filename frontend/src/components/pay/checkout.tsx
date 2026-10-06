"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Money, UsdMinimum } from "@/components/dash/money";
import { ChainSelect } from "@/components/pay/chain-select";
import { QRCode } from "@/components/pay/qr";
import { submitTx } from "@/lib/api/public";
import type { InvoiceStatus, PublicInvoice } from "@/lib/api/types";
import { chainLabel } from "@/lib/chains";

/**
 * The buyer's checkout.
 *
 * ⭐ This is the screen the whole product exists to fix. 85% of crypto
 * checkouts are abandoned, and the named causes are network-selection
 * confusion, unclear timers, missing QR codes and poor mobile layouts. Each one
 * has a specific answer here:
 *
 *   - Network confusion → the buyer picks the chain THEY already hold, and each
 *     chain has its own address. There is no bridging and no wrong network.
 *   - Unclear timers    → one countdown, always visible, that says what expiry
 *     actually means rather than just ticking down.
 *   - Missing QR        → server-rendered, above the fold, for every chain.
 *   - Mobile layout     → single column by default; the desktop split is the
 *     enhancement, not the base case.
 *
 * The buyer never connects a wallet and never signs in. That is only possible
 * because Aurora's deposit addresses mint against an arbitrary `sender`, so
 * there is nothing to authenticate.
 */

/** Statuses where the buyer still has something to do. */
const OPEN: InvoiceStatus[] = ["PENDING", "DETECTED"];

function useCountdown(expiresAt: string) {
  // Null until mounted: the server and the browser would otherwise compute
  // different remaining times and trip a hydration mismatch.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const target = new Date(expiresAt).getTime();
    if (Number.isNaN(target)) return;

    const tick = () => setRemaining(Math.max(0, target - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}

function formatRemaining(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard can be blocked (insecure origin, permissions). The address is
      // selectable text on the page regardless, so this is not worth an error.
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }, [value]);

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      className="shrink-0 rounded-lg border border-paper/20 px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper/80 transition-colors hover:border-paper/40 hover:text-paper"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * "I already sent it" — the accelerator.
 *
 * ⚠️ This is optional and it is NOT an error path. The payment is found by the
 * next poll whether or not the buyer touches this, so a failure here changes
 * nothing about whether they get their goods. That is why a rejected hash says
 * "we will find it anyway" rather than showing a red error: the buyer who
 * reaches for this is already anxious, and telling them their payment failed
 * when it has not is how this page creates the support ticket it exists to
 * prevent.
 *
 * It only exists because Aurora has no webhooks, so detection is a poll on an
 * interval. This lets a buyer who is watching skip the wait.
 */
function AlreadySent({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const value = hash.trim();
    if (!value || busy) return;

    setBusy(true);
    setNote("");
    const result = await submitTx(token, value);
    setBusy(false);

    // Both branches are reassuring on purpose — see the note above.
    setNote(
      result.ok && result.data.accepted
        ? "Thanks — we are looking for it now."
        : "Thanks. We could not match that reference, but your payment will still be found automatically.",
    );
    if (result.ok && result.data.accepted) setHash("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 text-[0.8125rem] text-paper/60 underline decoration-paper/30 underline-offset-4 transition-colors hover:text-paper"
      >
        Already sent it?
      </button>
    );
  }

  return (
    <form onSubmit={send} className="mt-4 border-t border-paper/10 pt-4">
      <label
        htmlFor="tx-hash"
        className="block text-[0.8125rem] leading-relaxed text-paper/60"
      >
        Paste the transaction ID from your wallet and we will look for it right
        away. You do not have to — it is found automatically either way.
      </label>
      <div className="mt-2.5 flex gap-2">
        <input
          id="tx-hash"
          name="tx_hash"
          value={hash}
          onChange={(e) => setHash(e.target.value)}
          placeholder="Transaction ID"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-lg border border-paper/20 bg-paper/[0.04] px-3 py-2 font-mono text-[0.8125rem] text-paper placeholder:text-paper/30 focus:border-paper/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !hash.trim()}
          className="shrink-0 rounded-lg border border-paper/20 px-3 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper/80 transition-colors hover:border-paper/40 hover:text-paper disabled:cursor-not-allowed disabled:text-paper/30"
        >
          {busy ? "Checking" : "Check"}
        </button>
      </div>
      {note && (
        <p role="status" className="mt-2.5 text-[0.8125rem] text-paper/70">
          {note}
        </p>
      )}
    </form>
  );
}

export default function Checkout({
  invoice,
  /** SSE endpoint. Empty when the API is not configured. */
  eventsUrl,
}: {
  invoice: PublicInvoice;
  eventsUrl: string;
}) {
  const [status, setStatus] = useState<InvoiceStatus>(invoice.status);
  const [selected, setSelected] = useState(invoice.addresses[0]?.chain ?? "");

  const remaining = useCountdown(invoice.expires_at);
  const expired = remaining !== null && remaining <= 0;
  const open = OPEN.includes(status) && !expired;

  const address = useMemo(
    () => invoice.addresses.find((a) => a.chain === selected),
    [invoice.addresses, selected],
  );

  /**
   * Live status.
   *
   * SSE rather than polling, because the moment a payment lands is the moment
   * the buyer is staring at the screen deciding whether this worked. The stream
   * is closed as soon as the invoice reaches a state the buyer cannot change.
   */
  // ⚠️ `status` is deliberately NOT a dependency, and `done` is a ref rather
  // than state. Depending on status tore the EventSource down and rebuilt it on
  // every transition — so the PENDING -> DETECTED hop, which happens while the
  // buyer is watching the screen, dropped the stream and reconnected. The
  // moment the connection is least replaceable is the moment it was being
  // recycled. One stream is opened, and it closes itself once the invoice
  // reaches a state the buyer cannot change.
  const done = useRef(false);

  useEffect(() => {
    if (!eventsUrl) return;

    const source = new EventSource(eventsUrl);
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as { status?: InvoiceStatus };
        if (!next.status) return;
        setStatus(next.status);
        if (!OPEN.includes(next.status)) {
          done.current = true;
          source.close();
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };
    // On error the browser reconnects on its own; nothing to do here.
    return () => source.close();
  }, [eventsUrl]);

  // Once paid, hand back to the merchant if they gave us somewhere to go.
  useEffect(() => {
    if (status !== "SETTLED" && status !== "OVERPAID") return;
    if (!invoice.redirect_url) return;
    const id = setTimeout(() => {
      window.location.href = invoice.redirect_url as string;
    }, 2500);
    return () => clearTimeout(id);
  }, [status, invoice.redirect_url]);

  if (!open) {
    /**
     * ⚠️ The deadline only turns a STILL-OPEN invoice into EXPIRED. Once the
     * backend reports a terminal state that state is the truth and the clock
     * is irrelevant: a settled payment viewed an hour later is still settled.
     * Letting the countdown override it told a buyer whose money had arrived
     * that their link had expired — the worst thing this page could say.
     */
    const resolved = OPEN.includes(status) && expired ? "EXPIRED" : status;
    return <Resolved status={resolved} invoice={invoice} />;
  }

  return (
    <div className="mx-auto w-full max-w-[60rem] px-4 py-8 md:px-6 md:py-12">
      <header className="mb-7 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="eyebrow text-mute">Pay {invoice.merchant_name}</p>
          <p className="mt-3 font-display text-[2.25rem] leading-none tracking-[-0.03em] md:text-[2.75rem]">
            {/* ⚠️ maxDp={8}, not the default 2. `Money` TRUNCATES rather
                than rounds, so a crypto-denominated invoice rendered at 2dp
                would quietly understate what is owed — and the buyer would
                send that smaller number, land under the minimum, and have
                the whole deposit auto-refunded. */}
            <Money amount={invoice.amount_expected} maxDp={8} />
            <span className="ml-2 font-mono text-[0.9375rem] tracking-[0.08em] text-mute">
              {invoice.currency}
            </span>
          </p>
        </div>
        <Countdown remaining={remaining} />
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Chain picker. Deliberately first in the DOM: choosing what you
            already hold is the first decision, and on mobile it must come
            before the address it changes. Collapsed to a dropdown so the
            address and QR stay on screen beside it however many chains the
            invoice offers. */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="eyebrow mb-1.5 text-mute">Pay with</h2>
          <p className="mb-4 text-[0.875rem] leading-relaxed text-mute">
            Send whatever you already hold. You do not need to bridge or swap, and
            you never need MON. The usual network fee of your own chain applies.
          </p>
          <ChainSelect
            id="pay-chain"
            options={invoice.addresses}
            value={selected}
            onChange={setSelected}
            disabled={!open}
          />
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
            Each chain has its own address. Pick yours and the address below
            changes to match.
          </p>
        </section>

        {/* The payment panel. Ink, because it is the one thing on this page
            that must be found instantly on a phone in a shop. */}
        <section className="rounded-2xl border border-ink bg-ink p-5 text-paper">
          {address ? (
            <>
              <h2 className="eyebrow mb-4 text-paper/50">
                Send to this address
              </h2>

              <div className="flex justify-center">
                <div className="rounded-xl bg-paper p-3">
                  <QRCode value={address.address} size={188} />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-paper/15 bg-paper/[0.04] p-3">
                <code className="min-w-0 flex-1 break-all font-mono text-[0.8125rem] leading-relaxed text-paper/90">
                  {address.address}
                </code>
                <CopyButton
                  value={address.address}
                  label="Copy payment address"
                />
              </div>

              {/* ⚠️ The minimum has to appear BEFORE they send. Below it, the
                  deposit is auto-refunded — and a refund nobody was warned
                  about arrives as a support ticket, not as a rescue.

                  The figure is USD, so it reads "worth of Bitcoin", never "on
                  Bitcoin": with the amount right beside the chain name, "on"
                  makes the unit look like BTC, and a buyer acting on 8.45 BTC
                  instead of $8.45 sends about six figures too much. */}
              {address.minimum && (
                <p className="mt-3 text-[0.8125rem] leading-relaxed text-paper/60">
                  Send at least{" "}
                  <span className="font-mono text-paper">
                    <UsdMinimum amount={address.minimum} />
                  </span>{" "}
                  worth of {chainLabel(address.chain)}. Anything below that is
                  returned to you automatically.
                </p>
              )}

              <p className="mt-4 border-t border-paper/10 pt-4 text-[0.8125rem] leading-relaxed text-paper/60">
                {status === "DETECTED"
                  ? "Payment spotted. Waiting for it to confirm — you can close this page, it will still complete."
                  : "This page updates by itself when your payment arrives. No need to refresh."}
              </p>

              <AlreadySent token={invoice.token} />
            </>
          ) : (
            <p className="text-[0.9375rem] text-paper/70">
              No payment address is available for this invoice yet.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Countdown({ remaining }: { remaining: number | null }) {
  // Before mount there is no honest value, so nothing is claimed.
  if (remaining === null) {
    return (
      <div className="text-right">
        <p className="eyebrow justify-end text-mute">Time left</p>
        <p className="mt-2 font-mono text-[1.125rem] tabular-nums text-mute">
          &mdash;:&mdash;&mdash;
        </p>
      </div>
    );
  }

  const urgent = remaining < 2 * 60 * 1000;

  return (
    <div className="text-right">
      <p className="eyebrow justify-end text-mute">Time left</p>
      <p
        className={`mt-2 font-mono text-[1.125rem] tabular-nums ${
          urgent ? "text-sand" : "text-ink"
        }`}
        // Announced at intervals rather than every second, which would make a
        // screen reader unusable.
        aria-live="off"
      >
        {formatRemaining(remaining)}
      </p>
    </div>
  );
}

/**
 * Every state where the buyer has nothing left to do.
 *
 * Each one says what happened to the money, because that is the only question
 * the buyer has. "Expired" alone prompts a support email; "nothing was sent,
 * nothing was taken" does not.
 */
function Resolved({
  status,
  invoice,
}: {
  status: InvoiceStatus;
  invoice: PublicInvoice;
}) {
  const COPY: Record<
    InvoiceStatus,
    { title: string; body: string; good: boolean }
  > = {
    SETTLED: {
      title: "Payment complete",
      body: `Your payment to ${invoice.merchant_name} has settled. You can close this page.`,
      good: true,
    },
    OVERPAID: {
      title: "Payment complete",
      body: `Your payment to ${invoice.merchant_name} has settled. You sent more than the amount due — contact ${invoice.merchant_name} about the difference.`,
      good: true,
    },
    UNDERPAID: {
      title: "Payment incomplete",
      body: `Less than the amount due arrived. A deposit below the chain's minimum is sent back to the address it came from automatically; anything above it reached ${invoice.merchant_name}. Contact ${invoice.merchant_name} about the difference.`,
      good: false,
    },
    EXPIRED: {
      title: "This payment link has expired",
      body: `Nothing was sent and nothing was taken. Ask ${invoice.merchant_name} for a new link.`,
      good: false,
    },
    CANCELLED: {
      title: "This payment was cancelled",
      body: `${invoice.merchant_name} cancelled this invoice. Nothing was taken.`,
      good: false,
    },
    NEEDS_RECOVERY: {
      title: "Your payment is being sorted out",
      body: `Your payment arrived, but the final step did not complete. It has not been lost — ${invoice.merchant_name} has been notified and it is being recovered.`,
      good: false,
    },
    PENDING: {
      title: "Waiting for payment",
      body: "This invoice is still open.",
      good: false,
    },
    DETECTED: {
      title: "Payment on its way",
      body: "Your payment has been seen and is confirming.",
      good: false,
    },
  };

  const copy = COPY[status];

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col items-center justify-center px-5 py-12 text-center">
      <div
        className={`flex h-16 w-16 items-center justify-center rounded-2xl ${
          copy.good ? "bg-sand text-paper" : "border border-line bg-paper"
        }`}
      >
        {copy.good ? (
          <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m4 12.5 5.5 5.5L20 7" />
          </svg>
        ) : (
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-mute" />
        )}
      </div>

      <h1 className="mt-7 font-display text-[1.75rem] leading-tight tracking-[-0.02em]">
        {copy.title}
      </h1>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-mute">
        {copy.body}
      </p>

      <p className="mt-8 font-mono text-[0.75rem] uppercase tracking-[0.12em] text-mute">
        <Money amount={invoice.amount_expected} maxDp={8} />{" "}
        {invoice.currency}
      </p>
    </div>
  );
}
