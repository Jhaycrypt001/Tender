import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveMerchant } from "@/lib/api/account";
import { accountsEnabled } from "@/lib/api/server";
import {
  SESSION_COOKIE,
  SESSION_SECONDS,
  encodeSession,
  isConfigured,
  type Session,
} from "@/lib/auth";
import { checkIdentityToken } from "@/lib/privy-server";

/**
 * Turns a Privy sign-in into a Tender session.
 *
 * The browser calls this once Privy says the person is signed in, sending the
 * identity token Privy issued. We verify it, find (or create, on the first
 * sign-in) the merchant for that person, and set the signed session cookie
 * every dashboard call acts through.
 *
 * ⚠️ A custom request header carries the token, not a cookie or the body. A
 * cross-site page cannot set a custom header without a CORS preflight, which
 * this route never answers, so another site cannot make a visitor's browser
 * start a session with a token of the attacker's choosing.
 */

const fail = (status: number, error: string) =>
  NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  if (!isConfigured()) return fail(503, "not_configured");

  const token = request.headers.get("x-privy-identity-token");
  if (!token) {
    console.warn("sign-in refused: no identity token sent");
    return fail(400, "missing_token");
  }

  const checked = await checkIdentityToken(token);
  if (!checked.ok) {
    // The reason goes to the server log only, never back to the browser.
    console.warn("sign-in refused: identity token not accepted", {
      reason: checked.reason,
      detail: checked.detail,
    });
    return fail(401, "invalid_token");
  }
  const who = checked.identity;

  // The wallet is created around login but not always before the first token is
  // issued. The browser creates it if needed and asks again.
  if (!who.wallet) {
    console.warn("sign-in waiting: identity token has no embedded wallet yet", { user: who.userId });
    return fail(409, "wallet_pending");
  }

  let merchantId: string | undefined;
  // Skipped only while the API is not connected, so a fresh clone still runs.
  if (accountsEnabled()) {
    const merchant = await resolveMerchant({ sub: who.userId, email: who.email, name: who.name });
    if (!merchant.ok) {
      console.error("resolving the merchant for a sign-in failed", {
        kind: merchant.error.kind,
        status: merchant.error.status,
      });
      return fail(502, "account_unavailable");
    }
    merchantId = merchant.data.id;
  }

  const session: Session = {
    sub: who.userId,
    email: who.email,
    name: who.name,
    merchantId,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  };

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return response;
}
