"use server";

import { createLink } from "@/lib/api/links";

/**
 * Creating a reusable payment link.
 *
 * A link is not an invoice. An invoice is one buyer paying one amount once; a
 * link is shared and mints a fresh invoice for every buyer who opens it. That
 * is why there is no expiry field here and no status — a link has `uses`, and
 * it is either active or it is not.
 */

export type LinkState = {
  message?: string;
  ok?: string;
  /** Per-field errors, keyed by input name. */
  fields?: Record<string, string>;
  /** What the merchant typed, so a rejected form comes back filled in. */
  values?: { label?: string; amount?: string; currency?: string };
};

/**
 * ⚠️ `amount` is OPTIONAL on purpose, and empty means "buyer chooses".
 *
 * `PaymentLink.amount` is `Amount | null`, and null is a real, supported
 * state — a tip jar, a donation, a "pay what you were invoiced" link. So an
 * empty amount box is not a validation failure to be corrected; it is the
 * merchant selecting the open-amount behaviour. Rejecting it would delete a
 * feature the API already has.
 */
export async function createLinkAction(
  _prev: LinkState,
  form: FormData,
): Promise<LinkState> {
  const label = String(form.get("label") ?? "").trim();
  const amount = String(form.get("amount") ?? "").trim();
  const currency = String(form.get("currency") ?? "").trim() || "USDC";

  const values = { label, amount, currency };
  const fields: Record<string, string> = {};

  if (!label) {
    fields.label = "Give the link a name so you can recognise it later.";
  }

  // Only validated when present, because absent is a valid choice.
  if (amount) {
    // Money is a string end to end. This checks the SHAPE, and deliberately
    // does not parseFloat: a float cannot hold an 18-decimal value, so the
    // moment this becomes a number it is already the wrong number.
    if (!/^\d+(\.\d+)?$/.test(amount)) {
      fields.amount = "Use digits only, like 25 or 25.00.";
    } else if (Number(amount) === 0) {
      fields.amount = "An amount of zero would ask the buyer for nothing.";
    }
  }

  if (Object.keys(fields).length > 0) {
    return { fields, values };
  }

  const result = await createLink({
    label,
    // Absent, not empty-string: the API distinguishes "no amount" from "".
    ...(amount ? { amount } : {}),
    currency,
  });

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") {
      return {
        values,
        message:
          "Links cannot be created yet — the Tender API is not connected in this environment.",
      };
    }
    return { values, fields: error.fields, message: error.message };
  }

  // ⚠️ No revalidatePath. A revalidate from inside a server action refreshes
  // the router and destroys the value `useActionState` is holding before it
  // can paint — measured on the refund screen at never rendering once in 150
  // samples. The new link is shown from the action's own result instead, and
  // the list picks it up on the next load. See `pay/actions.ts` for the
  // measurements.
  return {
    ok: `"${result.data.label}" is live. Share the link below.`,
    values: { currency },
  };
}
