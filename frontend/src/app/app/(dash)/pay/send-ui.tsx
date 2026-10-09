"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/dash/card";
import { Action } from "@/components/dash/action";
import { Select } from "@/components/dash/field";
import { Hash } from "@/components/dash/money";
import { STEP_LABEL, type SendStep } from "@/lib/use-send-transfer";
import type { PayoutChain, QuoteTransferResult, Transfer } from "@/lib/api/types";
import { payoutChainsAction, quoteTransferAction, transferStatusAction } from "./transfer-actions";

/**
 * Pieces shared by Payout, Split and Refund: one way of showing a message, one
 * receipt, one place that knows where a transaction can be looked up.
 */

export const EXPLORER = "https://monadvision.com";
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;

/** An EVM address, as the backend will accept it. The server decides; this only spares an obvious typo a round trip. */
export const looksLikeAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value.trim());

/** A decimal amount with at most 6 places (what USDC and USDT0 hold). */
export const looksLikeAmount = (value: string) => /^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value.trim()) && Number(value) > 0;

export function Note({ children, tone = "error" }: { children: React.ReactNode; tone?: "error" | "ok" | "info" }) {
  return (
    <p role={tone === "error" ? "alert" : "status"} className="text-[0.875rem] leading-relaxed text-ink">
      <span aria-hidden="true" className="mr-1.5 text-sand">
        &#9632;
      </span>
      {children}
    </p>
  );
}

export function stepText(step: SendStep | null): string {
  if (!step) return "";
  if (step.phase === "signing" && step.total > 1) return `Confirm payment ${step.index} of ${step.total} in your wallet…`;
  return STEP_LABEL[step.phase];
}

/* -------------------------------------------------------------------------- */
/* Sending to another chain                                                    */
/* -------------------------------------------------------------------------- */

export const MONAD = "monad";

/** The chains a payout can go to. Loaded once; while it loads, or if it fails, the list is empty and only Monad is offered. */
export function usePayoutChains(): PayoutChain[] {
  const [chains, setChains] = useState<PayoutChain[]>([]);
  useEffect(() => {
    let live = true;
    void payoutChainsAction().then((list) => live && setChains(list));
    return () => {
      live = false;
    };
  }, []);
  return chains;
}

/**
 * Asks the server whether Aurora will take this route and about what arrives, once the
 * address and amount look complete. Debounced, and a slow answer for an old input is dropped.
 */
export function useRouteQuote(chain: string, to: string, amount: string): "idle" | "checking" | QuoteTransferResult {
  const [result, setResult] = useState<"idle" | "checking" | QuoteTransferResult>("idle");
  useEffect(() => {
    if (chain === MONAD || !to.trim() || !looksLikeAmount(amount)) {
      setResult("idle");
      return;
    }
    let live = true;
    setResult("checking");
    const timer = setTimeout(() => {
      void quoteTransferAction({ dest_chain: chain, to: to.trim(), amount: amount.trim() }).then((r) => live && setResult(r));
    }, 700);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [chain, to, amount]);
  return result;
}

/** "Send to": Monad first (instant, no fee), then every other chain with what the recipient gets there. */
export function ChainPicker({ chains, value, onChange, disabled, resetKey }: { chains: PayoutChain[]; value: string; onChange: (id: string) => void; disabled?: boolean; resetKey?: number }) {
  if (chains.length === 0) return null;
  return (
    <fieldset disabled={disabled} className="contents">
      {/* The select keeps its own choice; a screen that picks the chain FOR the merchant bumps resetKey to show it. */}
      <Select
        key={resetKey}
        label="Send to"
        name="dest_chain"
        defaultValue={value}
        onChange={onChange}
        hint={value === MONAD ? "Monad is instant. Pick another chain to send there instead." : undefined}
        options={[{ value: MONAD, label: "Monad (USDC)" }, ...chains.map((c) => ({ value: c.id, label: `${c.name} (${c.asset})` }))]}
      />
    </fieldset>
  );
}

/** What the route check said, in plain words: the amount that arrives, or the reason it will not. */
export function RouteNote({
  chain,
  chains,
  quote,
  allErrors = false,
}: {
  chain: string;
  chains: PayoutChain[];
  quote: "idle" | "checking" | QuoteTransferResult;
  /** Show address and amount refusals here too. Off where the form already shows them under those fields. */
  allErrors?: boolean;
}) {
  const picked = chains.find((c) => c.id === chain);
  if (!picked) return null;
  return (
    <div className="flex flex-col gap-2">
      {quote === "checking" && <Note tone="info">Checking the route…</Note>}
      {typeof quote === "object" && quote.ok && (
        <Note tone="ok">
          {quote.receive ? `They receive about ${quote.receive} ${quote.asset} on ${picked.name}.` : `They receive ${quote.asset} on ${picked.name}.`} The fee comes out of the amount
          {quote.seconds ? `, and it arrives in about ${Math.max(1, Math.round(quote.seconds / 60))} min` : ""}.
        </Note>
      )}
      {typeof quote === "object" && !quote.ok && (allErrors || quote.field === "chain") && <Note>{quote.message}</Note>}
      {picked.memo_risk && (
        <Note tone="info">
          Do not send to an exchange or any address that needs a memo or tag. Tender cannot attach one, and money sent without it may be lost.
        </Note>
      )}
    </div>
  );
}

/**
 * The route check for one row of a split: asks about its own chain, address and amount, shows the
 * result under that row, and tells the form whether this row may go ahead.
 */
export function RowRoute({ chain, chains, to, amount, onReady }: { chain: string; chains: PayoutChain[]; to: string; amount: string; onReady: (ready: boolean) => void }) {
  const quote = useRouteQuote(chain, to, amount);
  const ready = routeReady(chain, quote);
  // Held in a ref so a new callback each render does not re-run the effect.
  const report = useRef(onReady);
  report.current = onReady;
  useEffect(() => report.current(ready), [ready]);
  // A split row's fields do not read the quote, so every refusal is shown here.
  return chain === MONAD ? null : <RouteNote chain={chain} chains={chains} quote={quote} allErrors />;
}

/** Whether the form may go ahead for this destination: Monad needs no check; another chain needs a good quote. */
export const routeReady = (chain: string, quote: "idle" | "checking" | QuoteTransferResult) => chain === MONAD || (typeof quote === "object" && quote.ok);

/** Shown when a transfer was sent. "Sent" only once the chain confirmed it. */
export function Receipt({ transfer: first, settled: firstSettled, onAgain, again }: { transfer: Transfer; settled: boolean; onAgain: () => void; again: string }) {
  const [transfer, setTransfer] = useState(first);
  const settled = firstSettled || transfer.status === "CONFIRMED";
  const crossLines = transfer.lines.filter((l) => l.dest);
  const pending = crossLines.filter((l) => l.dest!.status === "PENDING").length;
  const failed = crossLines.filter((l) => l.dest!.status === "FAILED").length;
  const delivered = crossLines.length - pending - failed;

  // Another chain: Aurora delivers a minute or two after the Monad leg, so keep asking until it has.
  useEffect(() => {
    const waiting = transfer.status === "SUBMITTED" || pending > 0;
    if (!waiting) return;
    let live = true;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 10 * 60_000) return clearInterval(timer);
      void transferStatusAction(transfer.id).then((r) => live && r.ok && setTransfer(r.transfer));
    }, 5_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [transfer.id, transfer.status, pending]);

  const headline = !settled
    ? "On its way."
    : crossLines.length === 0
      ? "Sent."
      : pending > 0
        ? "Sent. Arriving…"
        : failed > 0
          ? "Not fully delivered."
          : "Delivered.";
  const stateText = (l: Transfer["lines"][number]) =>
    !l.dest ? "" : l.dest.status === "DELIVERED" ? "Delivered" : l.dest.status === "FAILED" ? "Not delivered" : "Arriving";

  return (
    <Card tone="quiet" marks>
      <div role="status" className="flex flex-col gap-4">
        <p className="font-display text-[1.75rem] leading-none tracking-[-0.02em]">{headline}</p>
        <p className="text-[0.9375rem] leading-relaxed">
          {!settled
            ? `${transfer.total_amount} ${transfer.asset} was submitted and is still being confirmed. It will show as Sent in Recent transfers.`
            : crossLines.length === 0
              ? `${transfer.total_amount} ${transfer.asset} left your wallet.`
              : pending > 0
                ? `${transfer.total_amount} ${transfer.asset} left your wallet. ${pending === 1 ? "One payment is" : `${pending} payments are`} on the way to ${pending === 1 ? "another chain" : "other chains"}. This usually takes a minute or two.`
                : failed > 0
                  ? `${delivered} of ${crossLines.length} cross-chain payments arrived. ${failed === 1 ? "One" : failed} could not be delivered. Check your wallet; the money may have been returned.`
                  : "Everything arrived."}
        </p>
        <ul className="flex flex-col gap-1.5 text-[0.875rem]">
          {transfer.lines.map((line, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <Hash value={line.dest ? line.dest.address : line.to} lead={8} tail={6} />
                {line.dest && (
                  <span className="shrink-0 text-mute">
                    {line.dest.chain_name} · {stateText(line)}
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                {line.amount} {transfer.asset}
              </span>
            </li>
          ))}
        </ul>
        {transfer.tx_hash && (
          <a
            href={explorerTx(transfer.tx_hash)}
            target="_blank"
            rel="noreferrer"
            className="text-[0.875rem] text-sand underline-offset-4 hover:underline"
          >
            View the transaction &rarr;
          </a>
        )}
        <div>
          <Action onClick={onAgain}>{again}</Action>
        </div>
      </div>
    </Card>
  );
}

/** Why the form is closed, when it is: wallet not set up, nothing to send in, sending off. */
export function CannotSend({ reason }: { reason?: string | null }) {
  return (
    <Card tone="quiet">
      <p className="text-[0.9375rem] leading-relaxed">{reason ?? "Sending from your wallet is not available right now."}</p>
    </Card>
  );
}

export const PRIVY_ON = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID);
