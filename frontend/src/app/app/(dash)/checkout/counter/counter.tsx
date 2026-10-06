"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Card } from "@/components/dash/card";
import { Action, Submit } from "@/components/dash/action";
import { NfcGlyph, NfcWrite } from "@/components/dash/nfc-write";
import { QRCode } from "@/components/pay/qr";
import { getPublicInvoice, invoiceEventsUrl } from "@/lib/api/public";
import type { InvoiceStatus } from "@/lib/api/types";
import {
  cancelSaleAction,
  chargeAction,
  type ChargeState,
  type Sale,
} from "./actions";

/**
 * The counter — Tender at a till.
 *
 * Two phases, one screen:
 *   1. The merchant keys an amount and presses Charge. That creates an
 *      ordinary invoice; nothing here is a separate payment system.
 *   2. The screen turns to the customer: a large QR of the pay link, a
 *      tap-to-pay sticker option, and a live status that flips to Paid the
 *      moment the backend reports the invoice settled.
 *
 * The customer pays on THEIR phone, from the wallet they already have, exactly
 * as they would from a shared link. The counter only gets the link to them
 * faster: a camera scan, or a tap on an NFC sticker.
 *
 * "New sale" remounts the till (a fresh `round`), which is the only clean way
 * to reset `useActionState` — and it guarantees the next sale gets a new key.
 */
export function Counter({ appUrl }: { appUrl: string }) {
  const [round, setRound] = useState(0);
  return <Till key={round} appUrl={appUrl} onNext={() => setRound((r) => r + 1)} />;
}

/** 12 hex chars from the platform RNG. Stable for the life of one sale. */
function newKey(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const EMPTY: ChargeState = {};

function Till({ appUrl, onNext }: { appUrl: string; onNext: () => void }) {
  const [state, action] = useActionState(chargeAction, EMPTY);
  const [key, setKey] = useState("");
  useEffect(() => setKey(newKey()), []);

  if (state.sale) {
    return <SaleScreen sale={state.sale} appUrl={appUrl} onNext={onNext} />;
  }
  return <Keypad action={action} saleKey={key} message={state.message} />;
}

/* -------------------------------------------------------------------------- */
/* Phase 1: the amount                                                        */
/* -------------------------------------------------------------------------- */

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/** Apply one key press. Never produces more than 8 digits + 2 decimals. */
function press(value: string, k: string): string {
  if (k === "back") return value.slice(0, -1);
  if (k === ".") {
    if (value.includes(".")) return value;
    return value === "" ? "0." : `${value}.`;
  }
  const [whole, frac] = value.split(".");
  if (frac !== undefined) return frac.length >= 2 ? value : value + k;
  if (whole === "0") return k; // no leading zeros: "0" then "5" is "5"
  if (whole.length >= 8) return value;
  return value + k;
}

function Keypad({
  action,
  saleKey,
  message,
}: {
  action: (form: FormData) => void;
  saleKey: string;
  message?: string;
}) {
  const [value, setValue] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const valid = /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0;

  // A physical keyboard works too: a laptop on the counter is a common till.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^\d$/.test(e.key) || e.key === ".") setValue((v) => press(v, e.key));
      else if (e.key === ",") setValue((v) => press(v, "."));
      else if (e.key === "Backspace") setValue((v) => press(v, "back"));
      else if (e.key === "Escape") setValue("");
      else if (e.key === "Enter") form.current?.requestSubmit();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <form ref={form} action={action} className="mx-auto w-full max-w-[26rem]">
      <input type="hidden" name="amount" value={value.endsWith(".") ? value.slice(0, -1) : value} />
      <input type="hidden" name="key" value={saleKey} />

      <Card marks pad="lg">
        <p className="eyebrow text-mute">Amount to charge</p>
        <p
          className="mt-4 truncate font-display text-[clamp(2.75rem,2rem+4vw,4rem)] leading-none tracking-[-0.03em]"
          aria-live="polite"
        >
          <span className="text-mute">$</span>
          {value === "" ? <span className="text-mute">0</span> : value}
        </p>
        <p className="mt-3 text-[0.8125rem] text-mute">
          Priced in US dollars. You are paid in your settlement asset on Monad.
        </p>

        <div className="mt-6 grid grid-cols-3 gap-2" role="group" aria-label="Keypad">
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setValue((v) => press(v, k))}
              aria-label={k === "back" ? "Delete last digit" : k === "." ? "Decimal point" : k}
              className="h-14 rounded-xl border border-line bg-paper font-mono text-[1.25rem] text-ink transition-colors hover:border-ink/35 active:bg-stone"
            >
              {k === "back" ? "⌫" : k}
            </button>
          ))}
        </div>

        <Submit
          className="mt-5 h-12 w-full"
          pendingLabel="Creating sale…"
          disabled={!valid || !saleKey}
        >
          {valid ? `Charge $${value.replace(/\.$/, "")}` : "Charge"}
        </Submit>

        {message && (
          <p role="alert" className="mt-4 text-[0.875rem] leading-relaxed text-ink">
            <span aria-hidden="true" className="mr-1.5 text-sand">
              &#9632;
            </span>
            {message}
          </p>
        )}
      </Card>
    </form>
  );
}

/* -------------------------------------------------------------------------- */
/* Phase 2: the customer pays                                                 */
/* -------------------------------------------------------------------------- */

const OPEN: InvoiceStatus[] = ["PENDING", "DETECTED"];
const PAID: InvoiceStatus[] = ["SETTLED", "OVERPAID"];

/** What the merchant is told once the sale stops being payable. */
const CLOSED: Partial<Record<InvoiceStatus, string>> = {
  UNDERPAID:
    "Less than the amount arrived. Anything above the chain minimum reached your address; open the invoice to see exactly what came in.",
  EXPIRED: "This sale expired before it was paid. Start a new one if the customer still wants to pay.",
  CANCELLED: "This sale was cancelled.",
  NEEDS_RECOVERY:
    "The payment arrived but did not finish settling. Open the invoice for the recovery steps.",
};

function useStatus(sale: Sale): InvoiceStatus {
  const [status, setStatus] = useState<InvoiceStatus>(sale.status);
  const done = useRef(!OPEN.includes(sale.status));

  useEffect(() => {
    if (done.current) return;
    const url = invoiceEventsUrl(sale.token);
    let source: EventSource | null = null;

    const apply = (next: InvoiceStatus) => {
      setStatus(next);
      if (!OPEN.includes(next)) {
        done.current = true;
        source?.close();
        clearInterval(poll);
      }
    };

    if (url) {
      source = new EventSource(url);
      source.onmessage = (event) => {
        try {
          const next = JSON.parse(event.data) as { status?: InvoiceStatus };
          if (next.status) apply(next.status);
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      };
    }
    // A slow poll under the stream: a till left open for minutes must not
    // miss "Paid" because one SSE connection dropped quietly behind a proxy.
    const poll = setInterval(async () => {
      const r = await getPublicInvoice(sale.token);
      if (r.ok) apply(r.data.status);
    }, 6000);

    return () => {
      source?.close();
      clearInterval(poll);
    };
  }, [sale.token]);

  return status;
}

function useCountdown(expiresAt: string): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const end = Date.parse(expiresAt);
    const tick = () => setLeft(Math.max(0, Math.floor((end - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

/** Keep the screen awake while a customer is paying. Best effort only. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    type Lock = { release: () => Promise<void> };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<Lock> };
    };
    let lock: Lock | null = null;
    let cancelled = false;
    nav.wakeLock
      ?.request("screen")
      .then((l) => {
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
    };
  }, [active]);
}

function SaleScreen({
  sale,
  appUrl,
  onNext,
}: {
  sale: Sale;
  appUrl: string;
  onNext: () => void;
}) {
  const payUrl = `${appUrl}/pay/${sale.token}`;
  const status = useStatus(sale);
  const left = useCountdown(sale.expires_at);
  const panel = useRef<HTMLDivElement>(null);
  const [cancelling, setCancelling] = useState(false);

  // The clock only closes a STILL-OPEN sale; a paid one stays paid.
  const shown: InvoiceStatus =
    OPEN.includes(status) && left === 0 ? "EXPIRED" : status;
  const open = OPEN.includes(shown);
  const paid = PAID.includes(shown);
  useWakeLock(open);

  async function cancel() {
    setCancelling(true);
    await cancelSaleAction(sale.id);
    onNext();
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
      {/* Customer-facing. This is what goes full screen and gets turned round. */}
      <div
        ref={panel}
        className="[&:fullscreen]:flex [&:fullscreen]:items-center [&:fullscreen]:justify-center [&:fullscreen]:bg-paper [&:fullscreen]:p-6"
      >
        <Card marks pad="lg" className="w-full max-w-[34rem]">
          {paid ? (
            <Paid amount={sale.amount} over={shown === "OVERPAID"} />
          ) : (
            <div className="flex flex-col items-center text-center">
              <p className="eyebrow text-mute">Scan or tap to pay</p>
              <p className="mt-3 font-display text-[clamp(2.25rem,1.8rem+2.5vw,3.25rem)] leading-none tracking-[-0.03em]">
                ${sale.amount}
              </p>

              <div className={`mt-6 rounded-2xl border border-line bg-paper p-3 ${open ? "" : "opacity-25"}`}>
                <QRCode value={payUrl} size={240} className="h-auto w-[min(15rem,62vw)]" />
              </div>

              <p className="mt-5 max-w-[30ch] text-[0.9375rem] leading-relaxed">
                Point your phone camera at the code, or tap the{" "}
                <NfcGlyph className="inline h-4 w-4 align-[-3px] text-sand" /> sticker.
              </p>
              <p className="mt-2 max-w-[34ch] text-[0.8125rem] leading-relaxed text-mute">
                Pay from the wallet you already have: Bitcoin, Solana, Tron or
                any EVM chain. No app, no account, nothing to bridge.
              </p>

              <StatusLine status={shown} left={left} />
            </div>
          )}
        </Card>
      </div>

      {/* Merchant-facing controls. */}
      <div className="flex flex-col gap-4">
        {open && (
          <Card>
            <h3 className="eyebrow text-mute">Tap to pay</h3>
            <div className="mt-3">
              <NfcWrite
                url={payUrl}
                label="Write sale to sticker"
                hint="Puts this sale's link on an NFC sticker at your counter. The customer taps it with their phone instead of scanning."
              />
            </div>
          </Card>
        )}

        {!open && !paid && CLOSED[shown] && (
          <Card>
            <p className="text-[0.9375rem] leading-relaxed">{CLOSED[shown]}</p>
          </Card>
        )}

        <Card tone="quiet">
          <div className="flex flex-wrap gap-2">
            {paid || !open ? (
              <Action variant="primary" onClick={onNext}>
                New sale
              </Action>
            ) : (
              <>
                <Action
                  variant="primary"
                  onClick={() => panel.current?.requestFullscreen?.().catch(() => {})}
                >
                  Show to customer
                </Action>
                <Action onClick={cancel} disabled={cancelling}>
                  {cancelling ? "Cancelling…" : "Cancel sale"}
                </Action>
              </>
            )}
            <Link
              href={`/app/checkout/${encodeURIComponent(sale.id)}`}
              className="inline-flex items-center px-2 text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              Open invoice
            </Link>
          </div>
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
            Every sale is an ordinary invoice, so it also appears in Checkout and
            Activity, and fires your webhook.
          </p>
        </Card>
      </div>
    </div>
  );
}

function StatusLine({ status, left }: { status: InvoiceStatus; left: number | null }) {
  if (!OPEN.includes(status)) return null;
  const clock =
    left === null ? "" : ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} left`;
  return (
    <p
      role="status"
      className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-line px-3.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em]"
    >
      <span aria-hidden="true" className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sand/60 motion-reduce:hidden" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-sand" />
      </span>
      {status === "DETECTED" ? "Payment seen · confirming" : "Waiting for payment"}
      <span className="text-mute">{clock}</span>
    </p>
  );
}

function Paid({ amount, over }: { amount: string; over: boolean }) {
  return (
    <div className="flex flex-col items-center py-8 text-center" role="status">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-ink text-sand">
        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        </svg>
      </span>
      <p className="mt-6 font-display text-[clamp(2.25rem,1.8rem+2.5vw,3.25rem)] leading-none tracking-[-0.03em]">
        Paid
      </p>
      <p className="mt-3 text-[1.0625rem]">${amount}</p>
      <p className="mt-2 text-[0.875rem] text-mute">
        {over ? "More than the amount arrived. Settled on Monad." : "Settled on Monad."}
      </p>
    </div>
  );
}
