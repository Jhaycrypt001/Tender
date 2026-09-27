import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";
import { verifyMessage, type Hex, type PublicClient } from "viem";
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
 * Wallets:
 *  - ordinary wallets (EOAs) are checked locally, with no network call;
 *  - smart-contract wallets (Safe and other ERC-1271 wallets) are checked by
 *    asking the contract itself, over Monad RPC — only when the local check
 *    fails AND the address actually holds contract code.
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

/** The slice of a viem client needed for contract wallets. Optional: without it, EOAs only. */
export type ChainReader = Pick<PublicClient, "getCode" | "verifyMessage">;

export async function verifyChallenge(
  deps: { db: Db; redis: Pick<Redis, "get" | "del">; chain?: ChainReader },
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

  const valid = await signedBy(challenge.address as Hex, challenge.message, signature as Hex, deps.chain);
  if (!valid) throw new ApiError(400, "invalid_signature", "The signature does not match the settlement address.");

  // Single use. Deleting before the write means a racing second verify fails.
  const consumed = await deps.redis.del(key(merchant.id));
  if (consumed === 0) throw new ApiError(400, "challenge_expired", "No active challenge. Request a new one.");

  return deps.db.merchant.update({ where: { id: merchant.id }, data: { settlementVerified: true } });
}

async function signedBy(address: Hex, message: string, signature: Hex, chain: ChainReader | undefined): Promise<boolean> {
  // An ordinary wallet: pure signature recovery, no network.
  if (await verifyMessage({ address, message, signature }).catch(() => false)) return true;
  if (!chain) return false;

  // A smart-contract wallet validates signatures itself (ERC-1271).
  const code = await chain.getCode({ address }).catch(() => undefined);
  if (!code || code === "0x") return false;
  return chain.verifyMessage({ address, message, signature }).catch(() => false);
}
