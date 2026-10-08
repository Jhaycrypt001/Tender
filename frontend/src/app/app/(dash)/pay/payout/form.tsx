"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { Action } from "@/components/dash/action";
import { ControlledField } from "@/components/dash/field";
import { ReadOnlyField } from "@/components/dash/field";
import { useSendTransfer, type SendStep } from "@/lib/use-send-transfer";
import type { Transfer, WalletBalance } from "@/lib/api/types";
import { CannotSend, Note, PRIVY_ON, Receipt, looksLikeAddress, looksLikeAmount, stepText } from "../send-ui";

/**
 * Pay someone from your own wallet.
 *
 * The merchant's wallet signs; Tender relays it and pays the network fee. The
 * confirmation Privy shows before signing states the exact recipient and
 * amount, and the signature covers exactly those, so this form cannot send
 * anything other than what that confirmation said.
 */
export function PayoutForm({ wallet }: { wallet: WalletBalance }) {
  if (!PRIVY_ON) return <CannotSend reason="Sign-in is not set up in this environment, so there is no wallet to send from." />;
  if (!wallet.can_send) return <CannotSend reason={wallet.reason} />;
  return <PayoutLive wallet={wallet} />;
}

function PayoutLive({ wallet }: { wallet: WalletBalance }) {
  const send = useSendTransfer();
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<SendStep | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ transfer: Transfer; settled: boolean } | null>(null);
  const busy = step !== null;
  const asset = wallet.asset ?? "";

  const toError = to && !looksLikeAddress(to) ? "That is not a valid address." : fields["lines.0.to"];
  const amountError =
    amount && !looksLikeAmount(amount)
      ? "Enter an amount above zero, with up to 6 decimals."
      : amount && wallet.balance && Number(amount) > Number(wallet.balance)
        ? `Your wallet holds ${wallet.balance} ${asset}.`
        : fields["lines.0.amount"];
  const ready = looksLikeAddress(to) && looksLikeAmount(amount) && !amountError && !busy;

  async function submit() {
    setError("");
    setFields({});
    const outcome = await send(
      { kind: "PAYOUT", lines: [{ to: to.trim(), amount: amount.trim() }], ...(note.trim() ? { note: note.trim() } : {}) },
      setStep,
    );
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
      <CardHeader label="Send from your wallet" hint="From your settled balance. Tender pays the fee." />
      <div className="flex flex-col gap-5">
        <ReadOnlyField label="Your balance">
          <span className="tabular-nums text-[0.9375rem]">
            {wallet.balance ?? "—"} {asset}
          </span>
        </ReadOnlyField>

        <ControlledField label="Recipient address" value={to} onChange={setTo} placeholder="0x…" mono required error={toError} hint="An address on Monad. Copy it from the person you are paying: a wrong address cannot be undone." disabled={busy} />

        <ControlledField label="Amount" value={amount} onChange={setAmount} suffix={asset} inputMode="decimal" placeholder="0.00" required error={amountError} disabled={busy} />

        <ControlledField label="Note" value={note} onChange={setNote} placeholder="What this is for (only you see it)" hint="Optional." disabled={busy} />

        {error && <Note>{error}</Note>}
        {busy && <Note tone="info">{stepText(step)}</Note>}

        <div>
          <Action variant="primary" onClick={() => void submit()} disabled={!ready}>
            {busy ? "Sending…" : `Send ${amount && looksLikeAmount(amount) ? `${amount} ${asset}` : ""}`.trim()}
          </Action>
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-mute">
          You will be asked to confirm in your wallet. That confirmation names exactly who gets what, and nothing else can be sent with it.
        </p>
      </div>
    </Card>
  );
}
