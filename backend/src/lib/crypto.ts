import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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

/* -------------------------------------------------------------------------- */
/* Platform key                                                                */
/* -------------------------------------------------------------------------- */

/** Constant-time string comparison. Hashing first makes the lengths equal, so length leaks nothing either. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/* -------------------------------------------------------------------------- */
/* Webhook signing v2: the timestamp is covered                                */
/* -------------------------------------------------------------------------- */

/** How far a v2 timestamp may be from now before the delivery is rejected as a replay. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * `X-Tender-Signature-V2: sha256=<hex hmac of "<timestamp>.<raw body>">`, where
 * `<timestamp>` is the `X-Tender-Timestamp` header, unix seconds, of THAT attempt.
 *
 * v1 signs the body only, so its timestamp header can be altered or replayed
 * without breaking the signature. v2 closes that: changing the timestamp
 * changes the signature, and a captured request stops verifying once its
 * timestamp is older than the tolerance. v1 is still sent, unchanged, so no
 * existing merchant breaks. A retry is re-signed with its own fresh timestamp.
 */
export function signWebhookV2(rawBody: string, timestamp: number | string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

/**
 * The published /docs snippet for v2. Checks the signature in constant time AND
 * that the timestamp is a whole number within `toleranceSeconds` of now.
 */
export function verifyWebhookV2(
  rawBody: string,
  signatureHeader: string,
  timestampHeader: string,
  secret: string,
  opts: { toleranceSeconds?: number; now?: Date } = {},
): boolean {
  if (!/^\d{1,12}$/.test(timestampHeader)) return false;
  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(timestampHeader)) > (opts.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(signWebhookV2(rawBody, timestampHeader, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}
