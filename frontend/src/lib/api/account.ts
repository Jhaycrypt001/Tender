import { platformRequest } from "./server";
import type { ApiResult, Merchant } from "./types";

/**
 * Finds the merchant for a Google sign-in, creating it on the first one.
 * ⚠️ SERVER ONLY: called from the OAuth callback.
 *
 * The backend keys this on the Google `sub`, never the email: a `sub` is
 * permanent, while two Google accounts can share an email through aliasing.
 * A brand-new merchant has no settlement address, so it cannot take payments
 * until it verifies one in Settings.
 */
export function resolveMerchant(who: {
  sub: string;
  email: string;
  name: string;
}): Promise<ApiResult<Merchant>> {
  return platformRequest<Merchant>("/internal/merchants/resolve", {
    method: "POST",
    body: { google_sub: who.sub, email: who.email, name: who.name },
  });
}
