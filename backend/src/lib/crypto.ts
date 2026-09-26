import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import argon2 from "argon2";

/* -------------------------------------------------------------------------- */
/* Merchant API keys                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A merchant API key is shown once, at creation, and only its argon2 hash is
 * stored. The `tk_live_` prefix makes a leaked key recognisable in a scan.
 */
export function generateApiKey(): string {
  return `tk_live_${randomBytes(32).toString("base64url")}`;
}

export function hashApiKey(key: string): Promise<string> {
  return argon2.hash(key, { type: argon2.argon2id });
}

export function verifyApiKey(hash: string, key: string): Promise<boolean> {
  return argon2.verify(hash, key).catch(() => false);
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/* -------------------------------------------------------------------------- */
/* Webhook signing                                                             */
/* -------------------------------------------------------------------------- */

/**
 * `X-Tender-Signature: sha256=<hex hmac of the raw body>`.
 *
 * This must stay byte-for-byte compatible with the verification snippet
 * published at /docs, which merchants copy into their servers.
 */
export function signWebhook(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** The published /docs snippet, verbatim in behaviour. */
export function verifyWebhook(rawBody: string, header: string, secret: string): boolean {
  const a = Buffer.from(header);
  const b = Buffer.from(signWebhook(rawBody, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
