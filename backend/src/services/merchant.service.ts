import type { Db } from "../db/client.js";
import type { Merchant } from "../generated/prisma/client.js";
import { generateApiKey, generateWebhookSecret, hashApiKey, verifyApiKey } from "../lib/crypto.js";

/**
 * Lookup prefix length. `tk_live_` plus 8 characters: enough to find the one
 * row to argon2-verify, far too little to be useful if a log line leaks it.
 */
const PREFIX_LENGTH = 16;

export const apiKeyPrefix = (key: string) => key.slice(0, PREFIX_LENGTH);

export type CreateMerchantInput = {
  name: string;
  email: string;
  settlementAddress?: string;
  settlementAsset?: string;
  /**
   * Operator attestation that the settlement address is controlled by this
   * merchant. Only the operator bootstrap script sets it; merchants prove
   * control through the signature challenge (§8), never through this flag.
   */
  settlementVerified?: boolean;
};

/** Creates a merchant. The returned `apiKey` is shown once and never stored. */
export async function createMerchant(db: Db, input: CreateMerchantInput): Promise<{ merchant: Merchant; apiKey: string }> {
  const apiKey = generateApiKey();
  const merchant = await db.merchant.create({
    data: {
      name: input.name,
      email: input.email,
      settlementAddress: input.settlementAddress ?? null,
      settlementAsset: input.settlementAsset ?? "USDC",
      settlementVerified: input.settlementVerified ?? false,
      webhookSecret: generateWebhookSecret(),
      apiKeyHash: await hashApiKey(apiKey),
      apiKeyPrefix: apiKeyPrefix(apiKey),
    },
  });
  return { merchant, apiKey };
}

/**
 * Resolves a bearer key to its merchant, or null. The prefix narrows the
 * search to one row; the argon2 check is what actually authenticates.
 */
export async function authenticate(db: Db, key: string): Promise<Merchant | null> {
  if (!key.startsWith("tk_live_") || key.length < PREFIX_LENGTH + 8) return null;
  const merchant = await db.merchant.findUnique({ where: { apiKeyPrefix: apiKeyPrefix(key) } });
  if (!merchant) return null;
  return (await verifyApiKey(merchant.apiKeyHash, key)) ? merchant : null;
}

/** Settlement assets Aurora can deliver on Monad (verified live 2026-09-26). */
export const SETTLEMENT_ASSETS = ["USDC", "USDT0", "MON"] as const;

export type MerchantUpdate = {
  settlement_address?: string;
  settlement_asset?: string;
  webhook_url?: string;
};

/**
 * Applies a merchant's settings change.
 *
 * Changing the settlement address ALWAYS clears `settlementVerified`: a new
 * address must prove control again (§8) before a single invoice can route to
 * it. That is what stops a stolen session from silently redirecting revenue.
 */
export async function updateMerchant(db: Db, merchant: Merchant, input: MerchantUpdate): Promise<Merchant> {
  const data: Partial<Pick<Merchant, "settlementAddress" | "settlementAsset" | "settlementVerified" | "webhookUrl">> = {};

  if (input.settlement_address !== undefined) {
    const changed = input.settlement_address.toLowerCase() !== merchant.settlementAddress?.toLowerCase();
    data.settlementAddress = input.settlement_address;
    if (changed) data.settlementVerified = false;
  }
  if (input.settlement_asset !== undefined) data.settlementAsset = input.settlement_asset;
  if (input.webhook_url !== undefined) data.webhookUrl = input.webhook_url;

  return db.merchant.update({ where: { id: merchant.id }, data });
}
