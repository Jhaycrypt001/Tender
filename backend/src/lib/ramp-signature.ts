import { createPublicKey, verify, type KeyObject } from "node:crypto";
import stringify from "fast-json-stable-stringify";

/**
 * Checking that a webhook really came from Ramp Network.
 *
 * Ramp signs each webhook body with a private key only it holds, and publishes the matching
 * PUBLIC key in its docs (https://docs.rampnetwork.com/webhooks). So there is no secret on our
 * side to leak: anyone can check a signature, only Ramp can make one.
 *
 * The scheme, as documented:
 *   - header `X-Body-Signature`: a base64 ECDSA signature in DER form
 *   - curve secp256k1, digest SHA-256
 *   - over the JSON body re-serialized with `fast-json-stable-stringify` (keys sorted, no whitespace),
 *     NOT over the raw bytes. Query parameters on the webhook URL are not part of it.
 *
 * ⚠️ Because query parameters are not signed, `?merchant=` on our webhook URL is unauthenticated
 * text. It may say WHICH of our merchants a sale belongs to, never whether the sale is real.
 */

/** Ramp's published keys. Production signs live sales; testing signs the sandbox's. */
const PEM = {
  production: `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAElvxpYOhgdAmI+7oL4mABRAfM5CwLkCbZm64ERVKAisSulWFC3oRZom/PeyE2iXPX1ekp9UD1r+51c9TiuIHU4w==
-----END PUBLIC KEY-----`,
  testing: `-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEevN2PMEeIaaMkS4VIfXOqsLebj19kVeuwWl0AnkIA6DJU0r3ixkXVhJTltycJtkDoEAYtPHfARyTofB5ZNw9xA==
-----END PUBLIC KEY-----`,
} as const;

export type RampEnv = keyof typeof PEM;

export function rampPublicKey(env: RampEnv): KeyObject {
  return createPublicKey(PEM[env]);
}

/** True only for a signature Ramp's key made over exactly this body. Anything malformed is false, never a throw. */
export function verifyRampSignature(body: unknown, signature: string | undefined, key: KeyObject): boolean {
  if (!signature || body === null || typeof body !== "object") return false;
  try {
    return verify("sha256", Buffer.from(stringify(body)), key, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}
