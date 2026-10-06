import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sessions.
 *
 * Signing in is done by Privy (Google login, and an embedded wallet created
 * for the merchant). Privy proves who the person is; this file is what turns
 * that into OUR session: an HMAC-signed cookie naming the Tender merchant the
 * person acts as. Every dashboard call then acts for that merchant only (see
 * `lib/api/server.ts`), and the cookie cannot be edited without breaking its
 * signature.
 *
 * `isConfigured` exists so the UI can say plainly that sign-in is not set up,
 * instead of failing when the button is pressed.
 */

/** Public. Identifies this app to Privy; it is safe in the browser. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";

/** Falls back to localhost so a fresh clone works without any env at all. */
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/**
 * True when sign-in can work: the public app id (for the login popup) AND the
 * server-only secret (to verify who logged in). Having only the id would let
 * the popup open and then fail on the server, which reads as a broken product.
 */
export function isConfigured(): boolean {
  return Boolean(PRIVY_APP_ID && process.env.PRIVY_APP_SECRET);
}

/** Cookie holding the signed session. */
export const SESSION_COOKIE = "tender_session";

function secret(): string {
  const set = process.env.SESSION_SECRET;
  if (set) return set;
  // The fallback is a public string: anyone could sign a cookie with it. It exists
  // only so a fresh clone runs, and production refuses to use it.
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set. Refusing to sign sessions with the public development secret.");
  }
  return "tender-dev-secret-not-for-production";
}

export type Session = {
  /** The Privy user id (`did:privy:…`). Permanent for this person. */
  sub: string;
  email: string;
  name: string;
  picture?: string;
  /**
   * The Tender merchant this person maps to, found at sign-in through the
   * backend's `/internal/merchants/resolve`. It is signed with the rest of the
   * cookie, so a user cannot change which merchant they act as. Absent only
   * while the API is not connected.
   */
  merchantId?: string;
  /** Unix seconds. */
  exp: number;
};

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Returns null for anything that fails to verify, rather than throwing — a
 * tampered or expired cookie is an ordinary logged-out visitor, not an error.
 */
export function decodeSession(token: string | undefined): Session | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;

  const expected = sign(payload);
  // Compare in constant time; lengths must match before timingSafeEqual.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as Session;
    if (typeof session.exp !== "number" || session.exp < Date.now() / 1000) {
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/** Seconds a session lasts. Matches the cookie's `maxAge`. */
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
