import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { verifyMessage, type Hex } from "viem";
import type { Db } from "../db/client.js";
import type { Merchant } from "../generated/prisma/client.js";
import { ApiError, conflict } from "../lib/errors.js";

/**
 * Proof that a merchant controls their settlement address (BACKEND.md §8).
 *
 * Without it, a settlement address sits behind nothing but a login: a
 * phished account could point every future payment at an attacker. So an
 * address is unusable until the merchant signs a one-time challenge with the
 * wallet itself (EIP-191 personal_sign). Signing costs nothing and moves no
 * funds.
 *
 * - The challenge names the merchant, the exact address, a random nonce and
 *   an expiry, so a signature cannot be replayed for another merchant,
 *   another address, or later.
 * - It is single-use: consumed on the first successful verify.
 * - If the address changes after the challenge was issued, verification fails.
 *
 * Supports EOA wallets. Smart-contract wallets (ERC-1271) need an on-chain
 * call and are not supported yet.
 */

const TTL_SECONDS = 10 * 60;
const key = (merchantId: string) => `tender:settlement-challenge:${merchantId}`;

type Stored = { nonce: string; address: string; message: string; expiresAt: string };

export async function issueChallenge(redis: Pick<Redis, "set">, merchant: Merchant) {
  if (!merchant.settlementAddress) throw conflict("Set a settlement address before verifying it");
  if (merchant.settlementVerified) throw conflict("This settlement address is already verified");

  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  const message = [
    "Tender: verify settlement address",
    "",
    `Merchant: ${merchant.id}`,
    `Address: ${merchant.settlementAddress}`,
    `Nonce: ${nonce}`,
    `Expires: ${expiresAt}`,
    "",
    "Signing proves you control this address. It costs nothing and moves no funds.",
  ].join("\n");

  const stored: Stored = { nonce, address: merchant.settlementAddress, message, expiresAt };
  await redis.set(key(merchant.id), JSON.stringify(stored), "EX", TTL_SECONDS);
  return { nonce, message, expires_at: expiresAt };
}

export async function verifyChallenge(
  deps: { db: Db; redis: Pick<Redis, "get" | "del"> },
  merchant: Merchant,
  signature: string,
): Promise<Merchant> {
  const raw = await deps.redis.get(key(merchant.id));
  if (!raw) throw new ApiError(400, "challenge_expired", "No active challenge. Request a new one.");
  const challenge = JSON.parse(raw) as Stored;

  if (challenge.address.toLowerCase() !== merchant.settlementAddress?.toLowerCase()) {
    await deps.redis.del(key(merchant.id));
    throw new ApiError(400, "address_changed", "The settlement address changed after this challenge was issued. Request a new one.");
  }

  const valid = await verifyMessage({
    address: challenge.address as Hex,
    message: challenge.message,
    signature: signature as Hex,
  }).catch(() => false);
  if (!valid) throw new ApiError(400, "invalid_signature", "The signature does not match the settlement address.");

  // Single use. Deleting before the write means a racing second verify fails.
  const consumed = await deps.redis.del(key(merchant.id));
  if (consumed === 0) throw new ApiError(400, "challenge_expired", "No active challenge. Request a new one.");

  return deps.db.merchant.update({ where: { id: merchant.id }, data: { settlementVerified: true } });
}
