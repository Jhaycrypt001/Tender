"use server";

import { redirect } from "next/navigation";
import { createInvoice } from "@/lib/api/invoices";
import type { ChainId } from "@/lib/api/types";

/**
 * Creating an invoice.
 *
 * ⚠️ This runs on the server, and it is the reason the form is uncontrolled
 * native inputs rather than client state: `TENDER_PLATFORM_KEY` can create
 * invoices for any merchant, so the call that uses it must never be reachable
 * from the browser. The form posts here; the key never leaves the server, and
 * the merchant it acts for comes from the signed session, not the form.
 */

export type CreateState = {
  /** Field-level messages from the API's validation, keyed by field name. */
  fields?: Record<string, string>;
  /** A whole-form message, for failures that belong to no single field. */
  message?: string;
  /** What the merchant typed, so a rejected form comes back filled in. */
  values?: Record<string, string>;
};

/**
 * Money is read as a STRING and passed through untouched.
 *
 * No `parseFloat`, no `Number()`, no rounding. The merchant typed the amount
 * they are owed; converting it to a float and back can change the last digit,
 * and a checkout that silently alters the amount is worse than one that
 * rejects it. Validation here is shape-only — the backend's schema is the
 * authority, and its `fields` come straight back to the inputs.
 */
function readAmount(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  // Digits, one optional decimal point, at least one digit. Nothing else.
  if (!/^\d+(\.\d+)?$/.test(v)) return null;
  return v;
}

export async function createInvoiceAction(
  _prev: CreateState,
  form: FormData,
): Promise<CreateState> {
  const amount = String(form.get("amount_expected") ?? "");
  const currency = String(form.get("currency") ?? "").trim();
  const redirectUrl = String(form.get("redirect_url") ?? "").trim();
  const chains = form.getAll("chains").map(String) as ChainId[];

  // Echoed back so a rejected form is never cleared.
  const values = {
    amount_expected: amount,
    currency,
    redirect_url: redirectUrl,
  };

  const clean = readAmount(amount);
  const fields: Record<string, string> = {};

  if (!clean) {
    fields.amount_expected =
      "Enter an amount as digits, for example 49.00. No currency symbol.";
  }
  if (chains.length === 0) {
    fields.chains = "Pick at least one chain the buyer can pay from.";
  }

  if (Object.keys(fields).length > 0) return { fields, values };

  const result = await createInvoice(
    {
      amount_expected: clean as string,
      currency: currency || "USDC",
      // No reference: Tender numbers the invoice ORD-001, ORD-002… The submit button is
      // disabled while this runs, so one click is one invoice.
      ...(redirectUrl ? { redirect_url: redirectUrl } : {}),
      ...(chains.length ? { chains } : {}),
    },
  );

  if (!result.ok) {
    const { error } = result;

    if (error.kind === "not_configured") {
      return {
        values,
        message:
          "Invoices cannot be created yet — the Tender API is not connected in this environment.",
      };
    }
    // The backend validates with the shared schema, so its field messages are
    // rendered as-is rather than re-worded. There is no second validation
    // layer here to drift out of sync with it.
    if (error.fields && Object.keys(error.fields).length > 0) {
      return { values, fields: error.fields, message: error.message };
    }
    return { values, message: error.message };
  }

  // Straight to the invoice, where the pay link and QR are. A "created"
  // toast that leaves the merchant on the form would mean hunting for the
  // link they just made.
  redirect(`/app/checkout/${encodeURIComponent(result.data.id)}`);
}
