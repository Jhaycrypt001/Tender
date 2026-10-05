"use client";

import { Card } from "@/components/dash/card";
import { Action } from "@/components/dash/action";
import { Hash } from "@/components/dash/money";
import { STEP_LABEL, type SendStep } from "@/lib/use-send-transfer";
import type { Transfer } from "@/lib/api/types";

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

/** Shown when a transfer was sent. "Sent" only once the chain confirmed it. */
export function Receipt({ transfer, settled, onAgain, again }: { transfer: Transfer; settled: boolean; onAgain: () => void; again: string }) {
  return (
    <Card tone="quiet" marks>
      <div role="status" className="flex flex-col gap-4">
        <p className="font-display text-[1.75rem] leading-none tracking-[-0.02em]">{settled ? "Sent." : "On its way."}</p>
        <p className="text-[0.9375rem] leading-relaxed">
          {settled
            ? `${transfer.total_amount} ${transfer.asset} left your wallet.`
            : `${transfer.total_amount} ${transfer.asset} was submitted and is still being confirmed. It will show as Sent in Recent transfers.`}
        </p>
        <ul className="flex flex-col gap-1.5 text-[0.875rem]">
          {transfer.lines.map((line, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <Hash value={line.to} lead={8} tail={6} />
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
