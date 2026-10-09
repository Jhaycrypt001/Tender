"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/dash/card";
import { Action } from "@/components/dash/action";
import { ControlledField } from "@/components/dash/field";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { chainLabel } from "@/lib/chains";
import { fromMicro, toMicro } from "@/lib/micro";
import { useSendTransfer, type SendStep } from "@/lib/use-send-transfer";
import type { Payment, Transfer, WalletBalance } from "@/lib/api/types";
import { CannotSend, Note, PRIVY_ON, Receipt, looksLikeAddress, looksLikeAmount, stepText } from "../send-ui";

/**
 * Pick a payment, then send money back to the buyer.
 *
 * The refund is the merchant's own money leaving their own wallet, so it is a
 * transfer like a payout, with two differences that matter:
 *
 *  - It is TIED to a payment and capped by it: at most what that payment
 *    delivered, minus anything already refunded. The server enforces this under
 *    a lock; the figure shown here is only the courtesy.
 *  - The destination is typed by the merchant, with the address the payment
 *    came from filled in when it is one that can receive money on Monad.
 *
 * ⚠️ That prefilled address is a SUGGESTION, and it can be wrong. A buyer who
 * paid from an exchange paid from the exchange's wallet, and money sent back
 * there may never reach them. A smart-contract wallet is a different account on
 * every chain. The screen says so rather than presenting it as safe.
 */

const isEvmAddress = (value: string | null | undefined): value is string => !!value && /^0x[0-9a-fA-F]{40}$/.test(value);

/** What is still refundable on a payment, in micro-units: what it delivered, minus refunds already made. */
function refundable(p: Payment): bigint {
  const settled = toMicro(p.amount_settled ?? "0") ?? BigInt(0);
  const refunded = toMicro(p.refunded_amount ?? "0") ?? BigInt(0);
  return settled > refunded ? settled - refunded : BigInt(0);
}

export function RefundForm({ payments, wallet, initialId }: { payments: Payment[]; wallet: WalletBalance; initialId?: string }) {
  if (!PRIVY_ON) return <CannotSend reason="Sign-in is not set up in this environment, so there is no wallet to send from." />;
  if (!wallet.can_send) return <CannotSend reason={wallet.reason} />;
  return <RefundLive payments={payments} wallet={wallet} initialId={initialId} />;
}

function RefundLive({ payments, wallet, initialId }: { payments: Payment[]; wallet: WalletBalance; initialId?: string }) {
  const router = useRouter();
  const send = useSendTransfer();
  // Arriving from an overpaid invoice: that payment is already picked.
  const start = payments.find((p) => p.id === initialId && refundable(p) > BigInt(0));
  const [selected, setSelected] = useState(start?.id ?? "");
  const [to, setTo] = useState(start && isEvmAddress(start.sender) ? start.sender : "");
  const [amount, setAmount] = useState(start ? fromMicro(refundable(start)) : "");
  const [step, setStep] = useState<SendStep | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ transfer: Transfer; settled: boolean } | null>(null);
  const busy = step !== null;
  const asset = wallet.asset ?? "";

  const payment = payments.find((p) => p.id === selected);
  const left = payment ? refundable(payment) : BigInt(0);
  const sender = payment?.sender ?? null;
  const senderUsable = isEvmAddress(sender);

  function choose(p: Payment) {
    setSelected(p.id);
    setError("");
    setFields({});
    setTo(isEvmAddress(p.sender) ? p.sender : "");
    setAmount(fromMicro(refundable(p)));
  }

  const amountMicro = looksLikeAmount(amount) ? toMicro(amount) : null;
  const amountError =
    amount && amountMicro === null
      ? "Enter an amount above zero, with up to 6 decimals."
      : amountMicro !== null && amountMicro > left
        ? `You can refund at most ${fromMicro(left)} ${asset} of this payment.`
        : fields["lines.0.amount"];
  const toError = to && !looksLikeAddress(to) ? "That is not a valid address." : fields["lines.0.to"];
  const differs = senderUsable && looksLikeAddress(to) && to.trim().toLowerCase() !== sender.toLowerCase();
  const ready = !!payment && left > BigInt(0) && looksLikeAddress(to) && amountMicro !== null && amountMicro <= left && !busy;

  async function submit() {
    if (!payment) return;
    setError("");
    setFields({});
    const outcome = await send({ kind: "REFUND", payment_id: payment.id, lines: [{ to: to.trim(), amount: amount.trim() }] }, setStep);
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
        again="Refund another payment"
        onAgain={() => {
          setDone(null);
          setSelected("");
          setTo("");
          setAmount("");
          // The list above carries each payment's refunded total, so it must be read again.
          router.refresh();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader label="Choose the payment" hint="Settled payments only." />
        <fieldset disabled={busy}>
          <legend className="sr-only">Payment to refund</legend>
          <ul className="flex flex-col gap-1.5">
            {payments.map((p) => {
              const remaining = refundable(p);
              return (
                <li key={p.id}>
                  <label
                    className={`flex items-center gap-3 rounded-xl border border-line px-3.5 py-3 transition-colors has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper ${
                      remaining === BigInt(0) ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-mute/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment_id"
                      value={p.id}
                      checked={selected === p.id}
                      disabled={remaining === BigInt(0)}
                      onChange={() => choose(p)}
                      className="size-4 shrink-0 accent-ink"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="text-[0.9375rem]">{chainLabel(p.from_chain)}</span>
                        <span className="text-[0.9375rem]">
                          {p.amount_settled ? <Money amount={p.amount_settled} currency={asset} /> : null}
                        </span>
                      </span>
                      <span className="flex items-baseline justify-between gap-3 text-[0.75rem] opacity-70">
                        <Hash value={p.tx_hash} />
                        <span>
                          {remaining === BigInt(0) ? "Refunded in full" : p.refunded_amount && Number(p.refunded_amount) > 0 ? `${p.refunded_amount} refunded` : <Timestamp value={p.first_seen_at} />}
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      </Card>

      {payment && (
        <Card tone="quiet">
          <div className="flex flex-col gap-5">
            <ControlledField
              label="Send the refund to"
              value={to}
              onChange={setTo}
              placeholder="0x…"
              mono
              required
              error={toError}
              disabled={busy}
              hint="An address on Monad that the buyer controls. Copy it from the buyer: a wrong address cannot be undone."
            />

            {senderUsable ? (
              <Note tone="info">
                This payment came from <Hash value={sender} lead={8} tail={6} />, so it is filled in above. If the buyer paid from an exchange, that is the exchange&apos;s
                address and money sent back to it may not reach them. A smart-contract wallet is also a different account on Monad. If in doubt, ask the buyer for an address.
              </Note>
            ) : (
              <Note tone="info">
                {sender
                  ? `This payment came from ${chainLabel(payment.from_chain)}, and that address cannot receive money on Monad.`
                  : "Aurora did not report which address this payment came from."}{" "}
                Ask the buyer for an address they control on Monad.
              </Note>
            )}
            {differs && <Note tone="info">This is not the address the payment came from. Make sure the buyer gave it to you.</Note>}

            <ControlledField
              label="Amount to refund"
              value={amount}
              onChange={setAmount}
              suffix={asset}
              inputMode="decimal"
              placeholder="0.00"
              required
              error={amountError}
              disabled={busy}
              hint={`Up to ${fromMicro(left)} ${asset}. Your wallet holds ${wallet.balance ?? "—"} ${asset}.`}
            />

            {error && <Note>{error}</Note>}
            {busy && <Note tone="info">{stepText(step)}</Note>}

            <div>
              <Action variant="danger" onClick={() => void submit()} disabled={!ready}>
                {busy ? "Sending refund…" : "Send refund"}
              </Action>
            </div>
            <p className="text-[0.8125rem] leading-relaxed text-mute">
              This is your own money going back to the buyer, in {asset} on Monad. You confirm in your wallet, and Tender pays the network fee.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
