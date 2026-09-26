import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Google OAuth 2.0, server side.
 *
 * Nothing here is stubbed: this performs the real authorization-code exchange
 * against Google. What it cannot do is invent credentials — those belong to a
 * Google Cloud project that only the account owner can create. `isConfigured`
 * exists so the UI can say so plainly instead of failing at the redirect.
 */

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

/** Falls back to localhost so a fresh clone works without any env at all. */
export const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export const REDIRECT_URI = `${APP_URL}/app/callback`;

export function isConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

/** Cookie holding the signed session. */
export const SESSION_COOKIE = "tender_session";
/** Short-lived cookie holding the OAuth state nonce, for CSRF. */
export const STATE_COOKIE = "tender_oauth_state";

function secret(): string {
  // Dev fallback keeps a fresh clone runnable; production must set its own.
  return process.env.SESSION_SECRET ?? "tender-dev-secret-not-for-production";
}

export type Session = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
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

/** The URL we send the browser to in order to start sign-in. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

type GoogleTokenResponse = { id_token?: string; error?: string };

/**
 * Exchanges the authorization code for an id_token and reads the claims.
 *
 * The id_token's signature is not verified here because it arrived over TLS
 * directly from Google's token endpoint in response to our own authenticated
 * request — not via the browser. That is the one case where Google's own docs
 * permit skipping local validation.
 */
export async function exchangeCode(code: string): Promise<Session | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.id_token) return null;

  const claimsPart = data.id_token.split(".")[1];
  if (!claimsPart) return null;

  try {
    const claims = JSON.parse(
      Buffer.from(claimsPart, "base64url").toString(),
    ) as { sub: string; email: string; name?: string; picture?: string };

    return {
      sub: claims.sub,
      email: claims.email,
      name: claims.name ?? claims.email.split("@")[0],
      picture: claims.picture,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7,
    };
  } catch {
    return null;
  }
}
