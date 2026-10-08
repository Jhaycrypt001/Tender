"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader } from "@/components/dash/card";
import { AmountField, Field, Select } from "@/components/dash/field";
import { Submit } from "@/components/dash/action";
import { createLinkAction, type LinkState } from "./actions";

/**
 * Create a reusable payment link.
 *
 * The amount box is deliberately not required. Leaving it blank is how a
 * merchant makes an open-amount link — a tip jar, a donation, a deposit the
 * buyer decides. The hint says so in words, because an empty optional field
 * looks identical to one the merchant forgot to fill in.
 */

const EMPTY: LinkState = {};

export function LinkForm() {
  const router = useRouter();
  const [state, action] = useActionState(createLinkAction, EMPTY);
  // Reload after the success message has painted so the new link joins the list.
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);
  const v = state.values ?? {};

  return (
    <Card marks>
      <CardHeader
        label="New link"
        hint="One link, a fresh invoice per buyer."
      />

      <form action={action} className="flex flex-col gap-5">
        <Field
          label="Name"
          name="label"
          required
          placeholder="Monthly retainer"
          defaultValue={v.label}
          error={state.fields?.label}
          hint="Only you see this."
        />

        <AmountField
          label="Amount (optional)"
          name="amount"
          currency={v.currency || "USDC"}
          defaultValue={v.amount}
          error={state.fields?.amount}
          hint="Leave empty to let the buyer choose."
        />

        <Select
          label="Currency"
          name="currency"
          defaultValue={v.currency || "USDC"}
          error={state.fields?.currency}
          hint="Buyers still pay with any coin."
          // Only what the backend accepts for a link (USD or USDC): any other
          // value comes back as a validation error after the merchant has
          // already filled the form in. EUR and GBP return with a live FX rate.
          options={[
            { value: "USDC", label: "USDC" },
            { value: "USD", label: "USD" },
          ]}
        />

        {state.message && (
          <p
            role="alert"
            className="text-[0.875rem] leading-relaxed text-ink"
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
            className="text-[0.875rem] leading-relaxed text-ink"
          >
            <span aria-hidden="true" className="mr-1.5 text-sand">
              &#9632;
            </span>
            {state.ok}
          </p>
        )}

        <div>
          <Submit pendingLabel="Creating…">Create link</Submit>
        </div>
      </form>
    </Card>
  );
}
