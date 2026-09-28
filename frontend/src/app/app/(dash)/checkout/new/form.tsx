"use client";

import { useActionState } from "react";
import { AmountField, Field, Select } from "@/components/dash/field";
import { Card, CardHeader } from "@/components/dash/card";
import { Submit } from "@/components/dash/action";
import { UsdMinimum } from "@/components/dash/money";
import {
  createInvoiceAction,
  type CreateState,
} from "@/app/app/(dash)/checkout/actions";

/**
 * The create-invoice form.
 *
 * Every input is an uncontrolled native input with a `name`. There is no form
 * state library and no client-side validation mirror: the form posts to a
 * server action, the backend validates with the shared schema, and whatever it
 * says about a field is rendered against that field. One validation authority,
 * so the two cannot disagree.
 *
 * That also means this works before hydration.
 */

const EMPTY: CreateState = {};

/** A chain as this form needs it. `minimum` only exists when the API gave it. */
type ChainOption = { id: string; name: string; minimum?: string };

/**
 * The fallback chain list.
 *
 * ⚠️ Used ONLY when `GET /public/chains` is unreachable — which today is
 * always, because the backend does not exist yet. These are the demo set from
 * the plan, and they are labels for checkboxes, NOT data presented as fact: no
 * minimum and no settlement estimate is shown from here, because those numbers
 * must come from the API or not be shown at all.
 */
const FALLBACK: ChainOption[] = [
  { id: "bitcoin", name: "Bitcoin" },
  { id: "solana", name: "Solana" },
  { id: "base", name: "Base" },
  { id: "ethereum", name: "Ethereum" },
  { id: "arbitrum", name: "Arbitrum" },
  { id: "tron", name: "Tron" },
];

export function CreateInvoiceForm({
  chains,
  /** True when the list above is a fallback rather than live API data. */
  usingFallback,
}: {
  chains: ChainOption[];
  usingFallback: boolean;
}) {
  const [state, action] = useActionState(createInvoiceAction, EMPTY);
  const list = chains.length > 0 ? chains : FALLBACK;
  const v = state.values ?? {};

  return (
    <form action={action} className="grid gap-4 lg:grid-cols-[1.15fr_1fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            label="Amount"
            hint="What the buyer owes. They can pay it in any asset you accept."
          />
          <div className="flex flex-col gap-5">
            <AmountField
              label="Amount"
              name="amount_expected"
              currency="USDC"
              required
              defaultValue={v.amount_expected}
              error={state.fields?.amount_expected}
              hint="Digits only — 49.00, not $49."
            />
            <Select
              label="Settlement currency"
              name="currency"
              required
              defaultValue={v.currency || "USDC"}
              error={state.fields?.currency}
              hint="What you receive on Monad, whatever the buyer sends."
              options={[
                { value: "USDC", label: "USDC" },
                { value: "USDT", label: "USDT" },
                { value: "MON", label: "MON" },
              ]}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            label="Your reference"
            hint="Your own order number, so this invoice matches your records."
          />
          <div className="flex flex-col gap-5">
            <Field
              label="Order reference"
              name="reference"
              required
              placeholder="ORD-1042"
              defaultValue={v.reference}
              error={state.fields?.reference}
              hint="Must be unique. Creating twice with the same reference returns the first invoice rather than making a second."
            />
            <Field
              label="Redirect after payment"
              name="redirect_url"
              type="url"
              inputMode="url"
              placeholder="https://yourshop.com/thanks"
              defaultValue={v.redirect_url}
              error={state.fields?.redirect_url}
              hint="Where the buyer lands once it settles. Leave blank to keep them on the receipt."
            />
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            label="Chains accepted"
            hint="One deposit address is minted per chain you tick."
          />

          {/* Checkboxes, not a multi-select: on a phone a native multi-select
              is a scrolling list where nothing looks selected, and this is the
              field that decides whether a buyer can pay at all. */}
          <fieldset>
            <legend className="sr-only">Chains this invoice accepts</legend>
            <ul className="flex flex-col gap-1.5">
              {list.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-3.5 py-3 text-[0.9375rem] transition-colors hover:border-mute/50 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper">
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        name="chains"
                        value={c.id}
                        defaultChecked
                        className="size-4 accent-ink"
                      />
                      {c.name}
                    </span>
                    {/* Only rendered when the API supplied it. A minimum is a
                        number a merchant may quote to a buyer, so it is never
                        invented locally. */}
                    {c.minimum && (
                      <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-mute">
                        MIN <UsdMinimum amount={c.minimum} />
                      </span>
                    )}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          {state.fields?.chains && (
            <p role="alert" className="mt-3 text-[0.8125rem] text-ink">
              <span aria-hidden="true" className="mr-1.5 text-sand">
                &#9632;
              </span>
              {state.fields.chains}
            </p>
          )}

          {usingFallback && (
            <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
              This is the planned chain list. The live list, with each chain&rsquo;s
              minimum, loads once the API is connected.
            </p>
          )}
        </Card>

        <Card tone="quiet">
          {/* The form-level failure sits next to the button that caused it,
              not at the top of a long form the merchant has scrolled past. */}
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
          <Submit pendingLabel="Creating…">Create invoice</Submit>
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
            You get a link and a QR to hand the buyer. Nothing is charged to
            them until they send.
          </p>
        </Card>
      </div>
    </form>
  );
}
