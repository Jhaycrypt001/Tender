"use client";

import { useActionState } from "react";
import { AmountField, Field, Select } from "@/components/dash/field";
import { Card, CardHeader } from "@/components/dash/card";
import { Submit } from "@/components/dash/action";
import { ChainMultiSelect } from "@/components/dash/chain-multiselect";
import {
  createInvoiceAction,
  type CreateState,
} from "@/app/app/(dash)/checkout/actions";
import { CHAIN_IDS, DEFAULT_CHAIN_IDS, chainLabel } from "@/lib/chains";

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
 * Where the chain list came from:
 *  - live: measured by the backend, with minimums;
 *  - measuring: the backend is up but has no minimums yet (a 503);
 *  - not_connected: no API in this environment;
 *  - unavailable: the API failed to answer.
 */
export type ChainListState = "live" | "measuring" | "not_connected" | "unavailable";

/**
 * The fallback chain list: every chain the backend accepts, by name only.
 *
 * ⚠️ Used ONLY when there is no live list. They are labels for checkboxes, NOT
 * data presented as fact: no minimum and no settlement estimate is shown from
 * here, because those numbers must come from the API or not be shown at all.
 */
const FALLBACK: ChainOption[] = CHAIN_IDS.map((id) => ({ id, name: chainLabel(id) }));

const LIST_NOTE: Record<Exclude<ChainListState, "live">, string> = {
  measuring:
    "Minimums for each chain are still being measured, so none are shown yet. You can still create the invoice; the buyer's page shows minimums once they are known.",
  not_connected:
    "This is the full chain list. The live list, with each chain's minimum, loads once the API is connected.",
  unavailable:
    "The live chain list could not be loaded just now, so minimums are not shown. You can still create the invoice.",
};

export function CreateInvoiceForm({
  chains,
  listState,
}: {
  chains: ChainOption[];
  listState: ChainListState;
}) {
  const [state, action] = useActionState(createInvoiceAction, EMPTY);
  const list = chains.length > 0 ? chains : FALLBACK;
  const defaults = list.filter((c) => DEFAULT_CHAIN_IDS.has(c.id));
  const extras = list.filter((c) => !DEFAULT_CHAIN_IDS.has(c.id));
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
              currency="USD"
              required
              defaultValue={v.amount_expected}
              error={state.fields?.amount_expected}
              hint="Digits only — 49.00, not $49."
            />
            {/* ⚠️ This is what the AMOUNT is priced in, which the backend accepts
                only as USD or USDC. It is not what the merchant receives: that is
                the settlement asset (USDC, USDT0 or MON on Monad), set once in
                Settings. Offering USDT or MON here made the backend refuse the
                invoice with a validation error. */}
            <Select
              label="Priced in"
              name="currency"
              required
              defaultValue={v.currency || "USD"}
              error={state.fields?.currency}
              hint="What the amount is in. You are paid in your settlement asset on Monad, set in Settings."
              options={[
                { value: "USD", label: "USD" },
                { value: "USDC", label: "USDC" },
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

          {/* The common chains come first in the list, so the ones most buyers
              hold are the ones reached without scrolling. */}
          <ChainMultiSelect
            id="chains"
            options={[...defaults, ...extras]}
            defaultSelected={DEFAULT_CHAIN_IDS}
            invalid={Boolean(state.fields?.chains)}
            describedBy={state.fields?.chains ? "chains-error" : undefined}
          />
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
            Each chain you tick gets its own deposit address, so every extra one
            adds about a second to creating the invoice.
          </p>

          {state.fields?.chains && (
            <p id="chains-error" role="alert" className="mt-3 text-[0.8125rem] text-ink">
              <span aria-hidden="true" className="mr-1.5 text-sand">
                &#9632;
              </span>
              {state.fields.chains}
            </p>
          )}

          {listState !== "live" && (
            <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
              {LIST_NOTE[listState]}
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
