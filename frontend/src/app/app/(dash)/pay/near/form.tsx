"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { Action } from "@/components/dash/action";
import { ControlledField, ReadOnlyField } from "@/components/dash/field";
import { useSendTransfer, type SendStep } from "@/lib/use-send-transfer";
import type { Transfer, WalletBalance } from "@/lib/api/types";
import { CannotSend, Note, PRIVY_ON, Receipt, looksLikeAmount, looksLikeNearAccount, stepText, useNearQuote } from "../send-ui";

/**
 * Pay a NEAR account from your own wallet, through NEAR Intents.
 *
 * The merchant's wallet signs; Tender relays it and pays the network fee. The confirmation Privy shows before
 * signing names the NEAR account and the amount, and the signature covers exactly that transfer, so this form
 * cannot send anything other than what that confirmation said.
 */
export function NearForm({ wallet }: { wallet: WalletBalance }) {
  if (!PRIVY_ON) return <CannotSend reason="Sign-in is not set up in this environment, so there is no wallet to send from." />;
  if (!wallet.can_send) return <CannotSend reason={wallet.reason} />;
  return <NearLive wallet={wallet} />;
}

function NearLive({ wallet }: { wallet: WalletBalance }) {
  const send = useSendTransfer();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<SendStep | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ transfer: Transfer; settled: boolean } | null>(null);
  const quote = useNearQuote(to, amount);
  const busy = step !== null;
  const asset = wallet.asset ?? "";

  const quoteError = typeof quote === "object" && !quote.ok ? quote : null;
  const toError = to && !looksLikeNearAccount(to) ? "That is not a valid NEAR account, for example alice.near." : (fields["lines.0.to"] ?? (quoteError?.field === "to" ? quoteError.message : undefined));
  const amountError =
    amount && !looksLikeAmount(amount)
      ? "Enter an amount above zero, with up to 6 decimals."
      : amount && wallet.balance && Number(amount) > Number(wallet.balance)
        ? `Your wallet holds ${wallet.balance} ${asset}.`
        : (fields["lines.0.amount"] ?? (quoteError?.field === "amount" ? quoteError.message : undefined));
  // Send only once NEAR Intents has agreed to the route: a payout it would refuse is never offered.
  const routeOk = typeof quote === "object" && quote.ok;
  const ready = looksLikeNearAccount(to) && looksLikeAmount(amount) && !amountError && routeOk && !busy;

  async function submit() {
    setError("");
    setFields({});
    const outcome = await send({ near: { to: to.trim(), amount: amount.trim(), ...(note.trim() ? { note: note.trim() } : {}) } }, setStep);
    setStep(null);
    if (!outcome.ok) {
      setError(outcome.message);
      setFields(outcome.fields ?? {});
      return;
    }
    setDone({ transfer: outcome.transfer, settled: outcome.settled });
  }

  if (done) {
    return (
      <Receipt
        transfer={done.transfer}
        settled={done.settled}
        again="Send another"
        onAgain={() => {
          setDone(null);
          setTo("");
          setAmount("");
          setNote("");
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader label="Send to a NEAR account" hint="From your settled balance. Tender pays the network fee." />
      <div className="flex flex-col gap-5">
        <ReadOnlyField label="Your balance">
          <span className="tabular-nums text-[0.9375rem]">
            {wallet.balance ?? "—"} {asset}
          </span>
        </ReadOnlyField>

        <ControlledField
          label="NEAR account"
          value={to}
          onChange={setTo}
          placeholder="alice.near"
          mono
          required
          error={toError}
          hint="The recipient's NEAR account. Copy it from the person you are paying: a wrong account cannot be undone."
          disabled={busy}
        />

        <ControlledField label="Amount" value={amount} onChange={setAmount} suffix={asset} inputMode="decimal" placeholder="0.00" required error={amountError} disabled={busy} />

        <div className="flex flex-col gap-2">
          {quote === "checking" && <Note tone="info">Asking NEAR Intents…</Note>}
          {typeof quote === "object" && quote.ok && (
            <Note tone="ok">
              {quote.receive ? `They receive about ${quote.receive} ${quote.asset} on NEAR.` : `They receive ${quote.asset} on NEAR.`} NEAR Intents takes its fee out of the amount
              {quote.seconds ? `, and it arrives in about ${quote.seconds < 90 ? "a minute" : `${Math.round(quote.seconds / 60)} min`}` : ""}.
            </Note>
          )}
          {quoteError && quoteError.field === "chain" && <Note>{quoteError.message}</Note>}
        </div>

        <ControlledField label="Note" value={note} onChange={setNote} placeholder="What this is for (only you see it)" hint="Optional." disabled={busy} />

        {error && <Note>{error}</Note>}
        {busy && <Note tone="info">{stepText(step)}</Note>}

        <div>
          <Action variant="primary" onClick={() => void submit()} disabled={!ready}>
            {busy ? "Sending…" : `Send ${amount && looksLikeAmount(amount) ? `${amount} ${asset}` : ""}`.trim()}
          </Action>
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-mute">
          You will be asked to confirm in your wallet. That confirmation names the NEAR account and the amount, and nothing else can be sent with it. If NEAR Intents cannot deliver, the money is refunded to your wallet.
        </p>
      </div>
    </Card>
  );
}
