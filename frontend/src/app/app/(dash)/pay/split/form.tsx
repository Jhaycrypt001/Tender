"use client";

import { useState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { Action } from "@/components/dash/action";
import { ControlledField, ReadOnlyField } from "@/components/dash/field";
import { fromMicro, toMicro as parseMicro } from "@/lib/micro";
import { useSendTransfer, type SendStep } from "@/lib/use-send-transfer";
import type { Transfer, WalletBalance } from "@/lib/api/types";
import { CannotSend, ChainPicker, MONAD, Note, PRIVY_ON, Receipt, RowRoute, looksLikeAddress, looksLikeAmount, stepText, usePayoutChains } from "../send-ui";

/**
 * Divide one amount across several addresses.
 *
 * All or nothing on Monad, by construction: the backend puts every recipient's
 * authorization into ONE transaction, so it lands whole or not at all.
 *
 * A recipient can be on another chain. That row's money still leaves in the same
 * transaction (to a one-off address Aurora delivers from), so the Monad side stays
 * whole. What is no longer all-or-nothing is Aurora's delivery afterwards: each
 * such recipient is delivered on its own, and the receipt says which have arrived.
 */

const MAX_ROWS = 10;
const ZERO = BigInt(0);

// `id` is the row's identity, so removing one row cannot hand its chain choice to the next.
type Row = { id: number; to: string; amount: string; chain: string };
let nextRow = 0;
const blank = (): Row => ({ id: nextRow++, to: "", amount: "", chain: MONAD });

export function SplitForm({ wallet }: { wallet: WalletBalance }) {
  if (!PRIVY_ON) return <CannotSend reason="Sign-in is not set up in this environment, so there is no wallet to send from." />;
  if (!wallet.can_send) return <CannotSend reason={wallet.reason} />;
  return <SplitLive wallet={wallet} />;
}

function SplitLive({ wallet }: { wallet: WalletBalance }) {
  const send = useSendTransfer();
  const [rows, setRows] = useState<Row[]>([blank(), blank()]);
  const [evenTotal, setEvenTotal] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState<SendStep | null>(null);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ transfer: Transfer; settled: boolean } | null>(null);
  const chains = usePayoutChains();
  // Whether each cross-chain row's route check passed, by row id. A Monad row needs none.
  const [routeOk, setRouteOk] = useState<Record<number, boolean>>({});
  const busy = step !== null;
  const asset = wallet.asset ?? "";

  const toMicro = (v: string) => (looksLikeAmount(v) ? parseMicro(v) : null);
  const micro = rows.map((r) => toMicro(r.amount));
  const total = micro.reduce<bigint>((sum, v) => sum + (v ?? ZERO), ZERO);
  const balance = wallet.balance ? toMicro(wallet.balance) ?? ZERO : null;
  const over = balance !== null && total > balance;
  const addresses = rows.map((r) => `${r.chain}:${r.to.trim().toLowerCase()}`);
  const duplicate = (i: number) => rows[i]!.to.trim() !== "" && addresses.indexOf(addresses[i]!) !== i;
  const addressOk = (r: Row) => (r.chain === MONAD ? looksLikeAddress(r.to) : r.to.trim() !== "");
  const complete = rows.every((r, i) => addressOk(r) && micro[i] !== null && !duplicate(i) && (r.chain === MONAD || routeOk[r.id] === true));
  const ready = complete && !over && !busy && rows.length >= 2;

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function divideEvenly() {
    const t = toMicro(evenTotal);
    if (t === null) return;
    const n = BigInt(rows.length);
    const share = t / n;
    // The odd micro-units go to the first row, so the rows add up to the total exactly.
    const remainder = t - share * n;
    setRows((rs) => rs.map((r, i) => ({ ...r, amount: fromMicro(i === 0 ? share + remainder : share) })));
  }

  async function submit() {
    setError("");
    setFields({});
    const outcome = await send(
      { kind: "SPLIT", lines: rows.map((r) => ({ to: r.to.trim(), amount: r.amount.trim(), ...(r.chain !== MONAD ? { dest_chain: r.chain } : {}) })), ...(note.trim() ? { note: note.trim() } : {}) },
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
        again="Start another split"
        onAgain={() => {
          setDone(null);
          setRows([blank(), blank()]);
          setEvenTotal("");
          setNote("");
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader label="Recipients" hint="Paid in one transaction, all or nothing." />
        <div className="flex flex-col gap-6">
          {rows.map((row, i) => (
            <div key={row.id} className="flex flex-col gap-3 border-t border-line pt-5 first:border-t-0 first:pt-0">
              <ChainPicker chains={chains} value={row.chain} onChange={(c) => set(i, { chain: c })} disabled={busy} />
              <ControlledField
                label={`Recipient ${i + 1}`}
                value={row.to}
                onChange={(v) => set(i, { to: v })}
                placeholder={row.chain === MONAD ? "0x…" : "Address on that chain"}
                mono
                required
                disabled={busy}
                error={
                  row.chain === MONAD && row.to && !looksLikeAddress(row.to)
                    ? "That is not a valid address."
                    : duplicate(i)
                      ? "This address is already in the list."
                      : fields[`lines.${i}.to`]
                }
              />
              <ControlledField
                label="Amount"
                value={row.amount}
                onChange={(v) => set(i, { amount: v })}
                suffix={asset}
                inputMode="decimal"
                placeholder="0.00"
                required
                disabled={busy}
                error={row.amount && !looksLikeAmount(row.amount) ? "Enter an amount above zero, with up to 6 decimals." : fields[`lines.${i}.amount`]}
              />
              <RowRoute chain={row.chain} chains={chains} to={row.to} amount={row.amount} onReady={(ok) => setRouteOk((m) => (m[row.id] === ok ? m : { ...m, [row.id]: ok }))} />
              {rows.length > 2 && (
                <div>
                  <Action onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={busy}>
                    Remove
                  </Action>
                </div>
              )}
            </div>
          ))}
          {rows.length < MAX_ROWS && (
            <div>
              <Action onClick={() => setRows((rs) => [...rs, blank()])} disabled={busy}>
                Add a recipient
              </Action>
            </div>
          )}
        </div>
      </Card>

      <Card tone="quiet">
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
            <ControlledField label="Divide a total evenly" value={evenTotal} onChange={setEvenTotal} suffix={asset} inputMode="decimal" placeholder="0.00" hint="Fills every row with an equal share, to the last unit." disabled={busy} />
            <Action onClick={divideEvenly} disabled={busy || toMicro(evenTotal) === null}>
              Divide evenly
            </Action>
          </div>

          <ReadOnlyField label="Total to send">
            <span className="tabular-nums text-[0.9375rem]">
              {fromMicro(total)} {asset}
            </span>
          </ReadOnlyField>
          <ReadOnlyField label="Your balance">
            <span className="tabular-nums text-[0.9375rem]">
              {wallet.balance ?? "—"} {asset}
            </span>
          </ReadOnlyField>
          {over && <Note>This is more than your wallet holds.</Note>}

          <ControlledField label="Note" value={note} onChange={setNote} placeholder="What this is for (only you see it)" hint="Optional." disabled={busy} />

          {error && <Note>{error}</Note>}
          {busy && <Note tone="info">{stepText(step)}</Note>}

          <div>
            <Action variant="primary" onClick={() => void submit()} disabled={!ready}>
              {busy ? "Sending…" : `Send to ${rows.length} people`}
            </Action>
          </div>
          <p className="text-[0.8125rem] leading-relaxed text-mute">
            You confirm once per recipient in your wallet. Each confirmation names exactly who gets what. Nothing moves until the last one.
          </p>
        </div>
      </Card>
    </div>
  );
}
