import type { Db } from "../db/client.js";
import type { ApiKey, Merchant, WebhookDelivery } from "../generated/prisma/client.js";
import { generateApiKey, generateWebhookSecret, hashApiKey, verifyApiKey } from "../lib/crypto.js";
import { conflict, notFound } from "../lib/errors.js";
import { apiKeyId } from "../lib/ids.js";

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
      apiKeys: { create: { id: apiKeyId(), prefix: apiKeyPrefix(apiKey), hash: await hashApiKey(apiKey) } },
    },
  });
  return { merchant, apiKey };
}

/** `lastUsedAt` is written at most this often per key, so authenticating is not a database write every time. */
const LAST_USED_INTERVAL_MS = 60_000;

/**
 * Resolves a bearer key to its merchant, or null. The prefix narrows the
 * search to one row; the argon2 check is what actually authenticates. A
 * revoked key never authenticates.
 */
export async function authenticate(db: Db, key: string, now = new Date()): Promise<Merchant | null> {
  if (!key.startsWith("tk_live_") || key.length < PREFIX_LENGTH + 8) return null;
  const row = await db.apiKey.findUnique({ where: { prefix: apiKeyPrefix(key) }, include: { merchant: true } });
  if (!row || row.revokedAt) return null;
  if (!(await verifyApiKey(row.hash, key))) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
    // Best effort: a failed bookkeeping write must never fail the request.
    await db.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } }).catch(() => {});
  }
  return row.merchant;
}

/** Active keys one merchant may hold at once. Enough to rotate; too few to hoard. */
export const MAX_ACTIVE_KEYS = 10;

export async function listApiKeys(db: Db, merchant: Merchant): Promise<ApiKey[]> {
  return db.apiKey.findMany({ where: { merchantId: merchant.id, revokedAt: null }, orderBy: { createdAt: "desc" } });
}

/** Issues a key. The plaintext is returned once and never stored. */
export async function createApiKey(db: Db, merchant: Merchant): Promise<{ row: ApiKey; key: string }> {
  if ((await db.apiKey.count({ where: { merchantId: merchant.id, revokedAt: null } })) >= MAX_ACTIVE_KEYS) {
    throw conflict(`At most ${MAX_ACTIVE_KEYS} active API keys. Revoke one first.`);
  }
  // The prefix is 48 random bits and unique: a collision is astronomically rare, but retry once rather than 500.
  for (let attempt = 0; ; attempt++) {
    const key = generateApiKey();
    try {
      const row = await db.apiKey.create({
        data: { id: apiKeyId(), merchantId: merchant.id, prefix: apiKeyPrefix(key), hash: await hashApiKey(key) },
      });
      return { row, key };
    } catch (err) {
      if ((err as { code?: string }).code === "P2002" && attempt < 2) continue;
      throw err;
    }
  }
}

/** Revokes one of THIS merchant's keys. Another merchant's key id is indistinguishable from one that does not exist. */
export async function revokeApiKey(db: Db, merchant: Merchant, id: string): Promise<void> {
  const { count } = await db.apiKey.updateMany({ where: { id, merchantId: merchant.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (count === 0) throw notFound("API key");
}

/** Replaces the webhook signing secret. The new one is returned once; the old one stops verifying at once. */
export async function rotateWebhookSecret(db: Db, merchant: Merchant): Promise<string> {
  const webhookSecret = generateWebhookSecret();
  await db.merchant.update({ where: { id: merchant.id }, data: { webhookSecret } });
  return webhookSecret;
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

const WELCOME_DELAY_MS = 60_000;

export type GoogleIdentity = { googleSub: string; email: string; name: string };

/**
 * Finds or creates the merchant for a Google sign-in. Keyed on the Google
 * `sub`, never the email: a sub is permanent, while two accounts can share an
 * email through aliasing.
 *
 * A new merchant has no settlement address and no API key. It cannot
 * take payments until it proves an address, and it issues its own key from
 * Settings → Developers. `Merchant.email` is unique, so if the sign-in email
 * already belongs to another merchant (e.g. one the operator CLI made) we do
 * NOT link to it: that would let anyone who controls an aliased Google address
 * take over an existing account. The new merchant gets a `+<sub>` address
 * instead.
 */
export async function resolveGoogleMerchant(
  db: Db,
  who: GoogleIdentity,
  opts: { welcomeEmail?: boolean; now?: Date } = {},
): Promise<{ merchant: Merchant; created: boolean }> {
  const existing = await db.merchant.findUnique({ where: { googleSub: who.googleSub } });
  if (existing) return { merchant: existing, created: false };

  const taken = await db.merchant.findUnique({ where: { email: who.email } });
  const email = taken ? uniqueEmail(who.email, who.googleSub) : who.email;

  try {
    const merchant = await db.merchant.create({
      data: {
        name: who.name,
        email,
        googleSub: who.googleSub,
        settlementAsset: "USDC",
        webhookSecret: generateWebhookSecret(),
        // Queued in the SAME statement as the merchant: it exists if and only if the
        // merchant does, and the unique (merchant, kind) pair makes it once-only. The
        // first send waits a minute so a payout address set right after sign-in is
        // already in place when the message is built.
        emails: opts.welcomeEmail
          ? { create: { kind: "welcome", toEmail: email, nextRetryAt: new Date((opts.now ?? new Date()).getTime() + WELCOME_DELAY_MS) } }
          : undefined,
      },
    });
    return { merchant, created: true };
  } catch (err) {
    // Two first sign-ins racing: the loser finds the winner's row.
    if ((err as { code?: string }).code === "P2002") {
      const winner = await db.merchant.findUnique({ where: { googleSub: who.googleSub } });
      if (winner) return { merchant: winner, created: false };
    }
    throw err;
  }
}

function uniqueEmail(email: string, sub: string): string {
  const at = email.lastIndexOf("@");
  return `${email.slice(0, at)}+${sub}${email.slice(at)}`;
}

export type DeliveryStatus = "delivered" | "retrying" | "failed";

/** delivered: acknowledged. retrying: attempts left. failed: every retry used, never sent again. */
export function deliveryStatus(d: Pick<WebhookDelivery, "deliveredAt" | "nextRetryAt">): DeliveryStatus {
  if (d.deliveredAt) return "delivered";
  return d.nextRetryAt ? "retrying" : "failed";
}

/** This merchant's recent webhook deliveries, newest first, so they can see which ones never arrived. */
export async function listWebhookDeliveries(db: Db, merchant: Merchant, opts: { status?: DeliveryStatus; limit: number }) {
  const where =
    opts.status === "delivered"
      ? { deliveredAt: { not: null } }
      : opts.status === "retrying"
        ? { deliveredAt: null, nextRetryAt: { not: null } }
        : opts.status === "failed"
          ? { deliveredAt: null, nextRetryAt: null }
          : {};
  return db.webhookDelivery.findMany({
    where: { merchantId: merchant.id, ...where },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.limit,
  });
}
