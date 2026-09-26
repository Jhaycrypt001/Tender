import { randomBytes } from "node:crypto";

/**
 * Public identifiers.
 *
 * - `inv_` / `evt_` ids are merchant-facing and may appear in logs and URLs
 *   the merchant sees. 96 bits: unguessable, still short.
 * - `chk_` tokens go in the buyer's checkout URL. The spec requires at least
 *   128 bits from a CSPRNG; we use 160. A token carries no information and is
 *   never derived from the id.
 */
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Base62 over a CSPRNG, rejection-sampled so every character is uniform. */
function base62(chars: number): string {
  let out = "";
  while (out.length < chars) {
    for (const byte of randomBytes(chars * 2)) {
      // 248 = 62 * 4: bytes at or above it would bias the modulo.
      if (byte < 248) out += ALPHABET[byte % 62];
      if (out.length === chars) break;
    }
  }
  return out;
}

// log2(62) ≈ 5.954 bits per character.
export const invoiceId = () => `inv_${base62(17)}`; // ~101 bits
export const eventId = () => `evt_${base62(17)}`; // ~101 bits
export const checkoutToken = () => `chk_${base62(27)}`; // ~160 bits
export const linkId = () => `lnk_${base62(17)}`; // ~101 bits
export const linkToken = () => `pl_${base62(27)}`; // ~160 bits: public, in the link URL
