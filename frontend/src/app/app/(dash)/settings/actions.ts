"use server";

import { revalidatePath } from "next/cache";
import { getMerchant, updateMerchant } from "@/lib/api/merchant";
import { SETTLEMENT_ASSET_VALUES } from "@/lib/settlement-assets";

/**
 * Settlement settings.
 *
 * The settlement ADDRESS is not editable here. It is the wallet created for the
 * merchant when they signed in, set and proven by the sign-in setup
 * (`app/app/wallet-actions.ts`), so it never comes from a typed or pasted value
 * that could be a typo or an attacker's address. Only the ASSET paid out in is
 * a choice.
 */

export type SettlementState = {
  /** Field-level messages from the API, keyed by field name. */
  fields?: Record<string, string>;
  /** A whole-form message for failures that belong to no single field. */
  message?: string;
  /** Confirmation copy, on success. */
  ok?: string;
};

export async function saveSettlementAssetAction(
  _prev: SettlementState,
  form: FormData,
): Promise<SettlementState> {
  const asset = String(form.get("settlement_asset") ?? "").trim();

  if (!SETTLEMENT_ASSET_VALUES.includes(asset)) {
    return { fields: { settlement_asset: "Pick one of the assets listed." } };
  }

  if (asset === "MON") {
    const current = await getMerchant();
    if (!current.ok || current.data.settlement_asset !== "MON") {
      return { fields: { settlement_asset: "Choose USDC or USDT0. MON cannot be sent out from Tender." } };
    }
  }

  const result = await updateMerchant({ settlement_asset: asset });

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") {
      return {
        message:
          "Settlement cannot be changed yet — the Tender API is not connected in this environment.",
      };
    }
    if (error.fields && Object.keys(error.fields).length > 0) {
      return { fields: error.fields, message: error.message };
    }
    return { message: error.message };
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/home");

  return { ok: `Saved. New payments settle as ${asset}.` };
}
