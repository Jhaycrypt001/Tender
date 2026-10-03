"use server";

import { revalidatePath } from "next/cache";
import { retryPayment, withdrawPayment } from "@/lib/api/payments";

/**
 * Recovery, from the merchant's side.
 *
 * ⚠️ These two exist because of Aurora's refund asymmetry. A deposit that
 * fails BEFORE it lands is refunded automatically and never reaches this
 * screen. A settlement that fails AFTER the deposit succeeded is not refunded
 * by anyone — the money is real, it is in the system, and retry or withdraw
 * are the only two ways out. That is why there is no "refund" button here: the
 * one case a merchant can reach has no automatic refund available to offer.
 *
 * Like every write in this dashboard, these run on the server so the merchant
 * API key stays out of the browser.
 */

export type RecoveryState = {
  /** Shown next to the buttons when the call failed. */
  message?: string;
  /** Shown when it worked — recovery is slow, so silence would read as a bug. */
  ok?: string;
};

export async function recoverPaymentAction(
  _prev: RecoveryState,
  form: FormData,
): Promise<RecoveryState> {
  const id = String(form.get("payment_id") ?? "").trim();
  // Which submit button fired. One form, two actions.
  const intent = String(form.get("intent") ?? "").trim();

  if (!id) {
    return { message: "This payment could not be identified. Reload and try again." };
  }

  if (intent === "withdraw") {
    // No address is passed. The API defaults to the merchant's settlement
    // address — and a merchant who types one here under pressure, on the
    // screen that exists because settlement already failed once, is how funds
    // get sent somewhere unrecoverable. Changing it belongs in Settings.
    const result = await withdrawPayment(id);
    if (!result.ok) return { message: result.error.message };

    revalidatePath(`/app/activity/${id}`);
    revalidatePath("/app/activity");
    return {
      // Not "the funds are being returned": nothing has moved. Aurora has no
      // withdrawal API for deposit addresses, so the backend attaches a
      // ready-to-file support case to the recovery notes and keeps watching.
      ok: "Withdrawal requested. A support case for Aurora, naming your settlement address, is in this payment's recovery notes. The payment stays open until Aurora completes it; this screen updates if it settles.",
    };
  }

  if (intent === "retry") {
    const result = await retryPayment(id);
    if (!result.ok) return { message: result.error.message };

    revalidatePath(`/app/activity/${id}`);
    revalidatePath("/app/activity");
    return {
      ok: "Retry requested. Settlement is being attempted again — this screen updates as it progresses.",
    };
  }

  return { message: "Unknown action." };
}
