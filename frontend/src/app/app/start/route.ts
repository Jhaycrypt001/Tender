import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { APP_URL, STATE_COOKIE, buildAuthUrl, isConfigured } from "@/lib/auth";

/**
 * Begins sign-in. Mints a state nonce, stores it in an httpOnly cookie, and
 * redirects to Google. The callback refuses any response whose state does not
 * match that cookie, which is what stops a forged callback.
 */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/app?error=not_configured", APP_URL));
  }

  const state = randomBytes(16).toString("base64url");

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildAuthUrl(state));
}
