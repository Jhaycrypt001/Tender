"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import { identityFromToken } from "@/lib/privy-server";
import {
  getMerchant,
  requestSettlementChallenge,
  updateMerchant,
  verifySettlement,
} from "@/lib/api/merchant";

/**
 * Setting up where the merchant is paid, with the wallet Privy created for them.
 *
 * Two steps, split because the signature has to be made in the browser, by the
 * embedded wallet, and the browser must never be trusted with deciding WHICH
 * address that is:
 *
 *   1. `prepareSettlementAction`: the browser hands over its Privy identity
 *      token. We verify it, read the wallet address from the VERIFIED token,
 *      make it the merchant's settlement address, and get a one-off message to
 *      sign from the backend.
 *   2. `completeSettlementAction`: the browser returns the signature and the
 *      backend checks it against that address.
 *
 * The backend's proof-of-control check is unchanged. Here the signature is made
 * silently by the merchant's own wallet instead of being pasted by hand.
 */

export type SetupState =
  | { status: "ready" }
  | { status: "sign"; address: string; message: string; nonce: string }
  | { status: "error"; message: string };

const same = (a: string | null | undefined, b: string) =>
  !!a && a.toLowerCase() === b.toLowerCase();

const fail = (message: string): SetupState => ({ status: "error", message });

export async function prepareSettlementAction(idToken: string): Promise<SetupState> {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return fail("Your session ended. Sign in again.");

  // The token must be for the person this session belongs to. Without this, a
  // valid token for ANOTHER user could set this merchant's settlement address.
  const who = await identityFromToken(String(idToken ?? ""));
  if (!who || who.userId !== session.sub) {
    return fail("We couldn't confirm your sign-in. Sign out and back in.");
  }
  if (!who.wallet) return fail("Your wallet isn't ready yet. Try again in a moment.");

  const merchant = await getMerchant();
  if (!merchant.ok) return fail("We couldn't load your account. Try again in a moment.");
  const m = merchant.data;

  // Already proven: nothing to do. This also leaves alone an address a merchant
  // verified some other way, which this flow has no business replacing.
  if (m.settlement_verified) return { status: "ready" };

  // Not verified yet, so it cannot be receiving money and replacing it is safe.
  if (!same(m.settlement_address, who.wallet)) {
    const saved = await updateMerchant({ settlement_address: who.wallet });
    if (!saved.ok) return fail("We couldn't save your wallet as your settlement address. Try again.");
  }

  const challenge = await requestSettlementChallenge(who.wallet);
  if (!challenge.ok) return fail("We couldn't start verifying your wallet. Try again.");

  return {
    status: "sign",
    address: who.wallet,
    message: challenge.data.message,
    nonce: challenge.data.nonce,
  };
}

export async function completeSettlementAction(
  nonce: string,
  signature: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const n = String(nonce ?? "").trim();
  const s = String(signature ?? "").trim();
  if (!n) return { ok: false, message: "This check expired. Try again." };
  if (!/^0x[0-9a-fA-F]+$/.test(s)) return { ok: false, message: "Your wallet did not return a signature. Try again." };

  const result = await verifySettlement(n, s);
  if (!result.ok) return { ok: false, message: result.error.message };

  revalidatePath("/app/settings");
  revalidatePath("/app/home");
  return { ok: true };
}
