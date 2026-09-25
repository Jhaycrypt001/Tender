import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  APP_URL,
  SESSION_COOKIE,
  STATE_COOKIE,
  encodeSession,
  exchangeCode,
  isConfigured,
} from "@/lib/auth";

/**
 * Where Google sends the browser back. Verifies state, exchanges the code for
 * an id_token, and sets the session cookie.
 *
 * On success this redirects to /app/welcome rather than straight to the app:
 * the transition screen is where the account is set up, so it needs to be a
 * real destination the user lands on, not an overlay.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  // The user pressed "Cancel" on Google's consent screen. Not an error.
  if (denied) {
    return NextResponse.redirect(new URL("/app?error=cancelled", APP_URL));
  }

  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/app?error=not_configured", APP_URL));
  }

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/app?error=bad_state", APP_URL));
  }

  const session = await exchangeCode(code);
  if (!session) {
    return NextResponse.redirect(new URL("/app?error=exchange_failed", APP_URL));
  }

  const response = NextResponse.redirect(new URL("/app/welcome", APP_URL));

  response.cookies.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  // The state nonce is single-use.
  response.cookies.delete(STATE_COOKIE);

  return response;
}
