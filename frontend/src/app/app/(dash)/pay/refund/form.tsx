"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { Submit } from "@/components/dash/action";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { chainLabel } from "@/lib/chains";
import { refundAction, type RefundState } from "@/app/app/(dash)/pay/actions";
import type { Payment } from "@/lib/api/types";

/**
 * Pick a payment, then refund it.
 *
 * ⚠️ The merchant CHOOSES from real settled payments rather than typing an
 * address and an amount. That is the entire security design of this screen:
 * a refund can only ever go back along a path money actually arrived on, so
 * there is no field here for an attacker to talk a support agent into filling
 * in. The plan states it directly — refund "must link back to the originating
 * payment, never be a free-form send".
 */

const EMPTY: RefundState = {};

export function RefundForm({ payments }: { payments: Payment[] }) {
  const [state, action] = useActionState(refundAction, EMPTY);
  const [selected, setSelected] = useState<string>("");

  // The confirmation comes straight from the action state and nothing clears
  // it. That only holds because `refundAction` does NOT revalidate — a
  // revalidate from inside the action refreshes the router and destroys this
  // value before it paints. The reasoning, and the measurements, are in
  // `actions.ts`; if a revalidate is ever added there, this message silently
  // stops appearing and the merchant is told nothing after refunding.
  //
  // Once a refund has gone through, that payment is no longer refundable and
  // the list it came from is stale. Clearing the selection stops the merchant
  // pressing the button a second time on a row that has already gone.
  const done = Boolean(state.ok);
  const current = done ? "" : selected;

  return (
    <form action={action} className="flex flex-col gap-4">
      <Card>
        <CardHeader
          label="Choose the payment"
          hint="Only settled payments can be refunded. The money goes back the way it came."
        />

        <fieldset>
          <legend className="sr-only">Payment to refund</legend>
          <ul className="flex flex-col gap-1.5">
            {payments.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line px-3.5 py-3 transition-colors hover:border-mute/50 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper">
                  <input
                    type="radio"
                    name="payment_id"
                    value={p.id}
                    checked={current === p.id}
                    onChange={() => setSelected(p.id)}
                    className="size-4 shrink-0 accent-ink"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="text-[0.9375rem]">
                        {chainLabel(p.from_chain)}
                      </span>
                      <span className="text-[0.9375rem]">
                        <Money amount={p.amount_in} maxDp={8} />
                      </span>
                    </span>
                    <span className="flex items-baseline justify-between gap-3 text-[0.75rem] opacity-70">
                      <Hash value={p.tx_hash} />
                      <Timestamp value={p.first_seen_at} />
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </Card>

      <Card tone="quiet">
        {state.message && (
          <p
            role="alert"
            className="mb-4 text-[0.875rem] leading-relaxed text-ink"
          >
            <span aria-hidden="true" className="mr-1.5 text-sand">
              &#9632;
            </span>
            {state.message}
          </p>
        )}
        {state.ok && (
          <p
            role="status"
            className="mb-4 text-[0.875rem] leading-relaxed text-ink"
          >
            <span aria-hidden="true" className="mr-1.5 text-sand">
              &#9632;
            </span>
            {state.ok}
          </p>
        )}

        {/* Disabled until something is picked. The action checks this too —
            this is the courtesy, that is the guarantee. */}
        <Submit variant="danger" pendingLabel="Sending refund…" disabled={!current}>
          Refund this payment
        </Submit>

        <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
          The full amount goes back to the address it came from. Refunds cannot
          be partial, and cannot be sent anywhere else.
        </p>
      </Card>
    </form>
  );
}
