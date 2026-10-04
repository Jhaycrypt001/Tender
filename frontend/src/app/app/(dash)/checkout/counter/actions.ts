"use server";

import { cancelInvoice, createInvoice } from "@/lib/api/invoices";
import type { Amount, InvoiceStatus } from "@/lib/api/types";

/**
 * The counter: charging a customer standing in front of the merchant.
 *
 * ⚠️ Same rule as the create form: this runs on the server because the key
 * that creates invoices must never reach the browser. The counter screen is a
 * client component, so it reaches the API only through these two actions.
 */

export type Sale = {
  id: string;
  token: string;
  amount: Amount;
  currency: string;
  expires_at: string;
  status: InvoiceStatus;
};

export type ChargeState = { sale?: Sale; message?: string; key?: string };

/** Up to 8 digits, then up to 2 decimals. The keypad cannot produce more. */
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
/** The per-sale key the counter generates. Shape-checked, never trusted. */
const KEY = /^[0-9a-f]{12}$/;

export async function chargeAction(
  _prev: ChargeState,
  form: FormData,
): Promise<ChargeState> {
  const amount = String(form.get("amount") ?? "").trim();
  const key = String(form.get("key") ?? "");

  if (!AMOUNT.test(amount) || Number(amount) <= 0) {
    return { message: "Enter an amount above zero.", key };
  }
  if (!KEY.test(key)) {
    return { message: "Something went wrong preparing this sale. Clear it and start again.", key };
  }

  // ⚠️ The reference is derived from a key the counter makes once per sale and
  // keeps across retries. A double tap on Charge, or a retry after a timeout,
  // therefore returns the SAME invoice instead of charging the customer twice.
  const reference = `COUNTER-${key}`;

  const result = await createInvoice(
    // No `chains`: the merchant's default set (every EVM chain, Bitcoin,
    // Solana, Tron). A customer at a till pays from what is on their phone,
    // and those cover nearly all of it.
    { amount_expected: amount, currency: "USD", reference },
    reference,
  );

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") {
      return { key, message: "The Tender API is not connected in this environment, so sales cannot be taken yet." };
    }
    if (error.status === 409) {
      return { key, message: "Add and verify your settlement address in Settings before taking payments." };
    }
    return { key, message: error.message || "This sale could not be created. Try again." };
  }

  const inv = result.data;
  return {
    key,
    sale: {
      id: inv.id,
      token: inv.token,
      amount: inv.amount_expected,
      currency: inv.currency,
      expires_at: inv.expires_at,
      status: inv.status,
    },
  };
}

/**
 * Close an unpaid sale the merchant abandoned.
 *
 * Bookkeeping, not a refund: the deposit addresses stay live on Aurora's side,
 * so a customer who sends anyway is still detected and shows in Activity.
 */
export async function cancelSaleAction(id: string): Promise<{ ok: boolean }> {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(id)) return { ok: false };
  const result = await cancelInvoice(id);
  return { ok: result.ok };
}
