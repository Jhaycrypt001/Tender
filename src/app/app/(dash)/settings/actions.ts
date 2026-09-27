"use server";

import { revalidatePath } from "next/cache";
import {
  requestSettlementChallenge,
  updateMerchant,
  verifySettlement,
} from "@/lib/api/merchant";

/**
 * Settlement and account writes.
 *
 * ⚠️ This file holds the most dangerous write in the product. Changing
 * `settlement_address` changes where every future payment lands. The backend
 * resets `settlement_verified` to false whenever the address changes, and an
 * unverified address must not receive money — so the address form and the
 * proof-of-control flow are two halves of ONE operation, not two features.
 * Saving an address and walking away leaves the merchant unable to be paid,
 * which is why `saveSettlementAction` returns the merchant straight into the
 * challenge step rather than reporting a cheerful "Saved".
 */

export type SettlementState = {
  /** Field-level messages from the API, keyed by field name. */
  fields?: Record<string, string>;
  /** A whole-form message for failures that belong to no single field. */
  message?: string;
  /** Confirmation copy, on success. */
  ok?: string;
  /** What the merchant typed, so a rejected form comes back filled in. */
  values?: Record<string, string>;
};

/**
 * A Monad address, checked for SHAPE only.
 *
 * This is not validation in any meaningful sense and is not treated as such —
 * the backend is the authority and its `fields` come straight back to the
 * input. The check exists to catch the obvious paste error (a truncated
 * address, a stray space, an ENS name) before it costs a round trip, because
 * the merchant is usually pasting from a wallet they have open in another
 * window.
 *
 * ⚠️ It deliberately does NOT checksum. A valid-but-wrong address passes any
 * local check ever written; only the signature proves ownership.
 */
function looksLikeAddress(raw: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(raw.trim());
}

export async function saveSettlementAction(
  _prev: SettlementState,
  form: FormData,
): Promise<SettlementState> {
  const address = String(form.get("settlement_address") ?? "").trim();
  const asset = String(form.get("settlement_asset") ?? "").trim();

  const values = { settlement_address: address, settlement_asset: asset };
  const fields: Record<string, string> = {};

  if (!address) {
    fields.settlement_address = "Enter the address money should land in.";
  } else if (!looksLikeAddress(address)) {
    fields.settlement_address =
      "That does not look like a Monad address. It starts 0x and is 42 characters.";
  }

  if (Object.keys(fields).length > 0) return { fields, values };

  const result = await updateMerchant({
    settlement_address: address,
    ...(asset ? { settlement_asset: asset } : {}),
  });

  if (!result.ok) {
    const { error } = result;

    if (error.kind === "not_configured") {
      return {
        values,
        message:
          "Settlement cannot be changed yet — the Tender API is not connected in this environment.",
      };
    }
    if (error.fields && Object.keys(error.fields).length > 0) {
      return { values, fields: error.fields, message: error.message };
    }
    return { values, message: error.message };
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/home");

  // Deliberately NOT "Saved." The address is stored but unverified, which
  // means it cannot be paid to yet, and saying "Saved" would hide that.
  return {
    ok: "Address saved. It cannot receive payments until you prove you own it — do that below.",
  };
}

/* --------------------------------------------------------------------------
   Proof of control.
   -------------------------------------------------------------------------- */

export type ChallengeState = {
  /** The exact string to sign, from the API. Never rebuilt locally. */
  message?: string;
  nonce?: string;
  expires_at?: string;
  error?: string;
};

/**
 * Step one: ask the backend for a nonce.
 *
 * The message comes back from the API and is rendered verbatim. Composing it
 * on the client would mean two different strings could exist for one nonce,
 * and the merchant would sign one while the backend checked the other.
 */
export async function startChallengeAction(
  _prev: ChallengeState,
  form: FormData,
): Promise<ChallengeState> {
  const address = String(form.get("address") ?? "").trim();

  if (!address) {
    return { error: "Save a settlement address first." };
  }

  const result = await requestSettlementChallenge(address);

  if (!result.ok) {
    if (result.error.kind === "not_configured") {
      return {
        error:
          "Verification is not available yet — the Tender API is not connected in this environment.",
      };
    }
    return { error: result.error.message };
  }

  return {
    message: result.data.message,
    nonce: result.data.nonce,
    expires_at: result.data.expires_at,
  };
}

export type VerifyState = { error?: string; ok?: string };

/** Step two: submit the signature produced by the settlement wallet. */
export async function verifySettlementAction(
  _prev: VerifyState,
  form: FormData,
): Promise<VerifyState> {
  const nonce = String(form.get("nonce") ?? "").trim();
  const signature = String(form.get("signature") ?? "").trim();

  if (!nonce) {
    return { error: "This challenge expired. Start a new one." };
  }
  if (!signature) {
    return { error: "Paste the signature your wallet produced." };
  }

  const result = await verifySettlement(nonce, signature);

  if (!result.ok) {
    if (result.error.kind === "not_configured") {
      return {
        error:
          "Verification is not available yet — the Tender API is not connected in this environment.",
      };
    }
    return { error: result.error.message };
  }

  revalidatePath("/app/settings");
  revalidatePath("/app/home");

  return { ok: "Verified. Payments will now settle to this address." };
}
