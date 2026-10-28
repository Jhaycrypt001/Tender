import { Prisma } from "../generated/prisma/client.js";
import type { RampSale, RampSaleStatus } from "../generated/prisma/client.js";
import { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import { rampSaleId, rampWebhookToken as newWebhookToken } from "../lib/ids.js";
import { fromBaseUnits, isAmount } from "../lib/money.js";
import { amount } from "./serialize.js";

/**
 * Recording cash-outs through Ramp Network.
 *
 * ⚠️ This only RECORDS. It never moves money, mints a deposit address or touches a bank detail:
 * the merchant sends from their own wallet to an address Ramp's widget gave them, and Ramp pays
 * the fiat out. The row exists so Activity can list the withdrawal as money OUT.
 */

const FiatAmount = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine(isAmount, "not a decimal amount");

/**
 * Base units. Ramp's docs show a string, which is what keeps an 18-decimal amount exact. A JSON number is
 * accepted only while it is a safe integer: past 2^53 the parser has already changed the digits, so it is
 * refused (loudly) rather than recorded wrong.
 */
const BaseUnits = z.union([
  z.string().regex(/^\d+$/, "not a base-unit integer"),
  z
    .number()
    .refine((n) => Number.isSafeInteger(n) && n >= 0, "not a base-unit integer that survives JSON exactly")
    .transform((n) => String(n)),
]);

/** What we read from a Ramp off-ramp webhook. Fields we do not use are ignored, so Ramp adding one breaks nothing. */
export const RampEvent = z.object({
  id: z.string().min(1),
  type: z.string(),
  mode: z.string(),
  payload: z.object({
    id: z.string().min(1),
    transactionHash: z.string().nullish(),
    crypto: z.object({
      amount: BaseUnits,
      assetInfo: z.object({ symbol: z.string().min(1), chain: z.string().min(1), decimals: z.number().int().min(0).max(36) }),
    }),
    fiat: z.object({
      amount: FiatAmount,
      currencySymbol: z.string().min(1),
      payoutMethod: z.string().nullish(),
    }),
  }),
});

/** The only states Ramp sends for an off-ramp sale. Anything else is acknowledged and ignored, not guessed at. */
const STATUSES = ["CREATED", "RELEASED", "EXPIRED"] as const;
export const isKnownStatus = (s: string): s is RampSaleStatus => (STATUSES as readonly string[]).includes(s);

export type ApplyOutcome = "created" | "advanced" | "duplicate";

/**
 * Apply one verified event. Safe to call any number of times with the same or an out-of-order event.
 *
 * - First sight of a sale inserts it.
 * - CREATED to RELEASED or EXPIRED advances it.
 * - Anything else (a repeat, a late CREATED after RELEASED, a RELEASED after EXPIRED) changes nothing.
 *
 * Both steps are single statements guarded by the database (the unique sale id; `status = CREATED`),
 * so two retries arriving together cannot double-record or overwrite each other.
 */
export async function applyRampEvent(
  db: Db,
  event: z.output<typeof RampEvent>,
  status: RampSaleStatus,
  merchantId: string | null,
): Promise<ApplyOutcome> {
  const { payload } = event;
  const fields = {
    status,
    cryptoSymbol: payload.crypto.assetInfo.symbol,
    cryptoChain: payload.crypto.assetInfo.chain,
    cryptoAmount: fromBaseUnits(payload.crypto.amount, payload.crypto.assetInfo.decimals),
    fiatCurrency: payload.fiat.currencySymbol,
    fiatAmount: payload.fiat.amount,
    payoutMethod: payload.fiat.payoutMethod ?? null,
    transactionHash: payload.transactionHash ?? null,
  };

  try {
    await db.rampSale.create({ data: { id: rampSaleId(), rampSaleId: payload.id, merchantId, ...fields } });
    return "created";
  } catch (err) {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") throw err;
  }

  // Already known. Only a CREATED sale can still move, and only to a final state.
  if (status === "CREATED") return "duplicate";
  const moved = await db.rampSale.updateMany({ where: { rampSaleId: payload.id, status: "CREATED" }, data: fields });
  return moved.count > 0 ? "advanced" : "duplicate";
}

const WEBHOOK_TOKEN = /^rwt_[0-9A-Za-z]{27}$/;

/**
 * Which merchant a webhook token belongs to, or null.
 *
 * ⚠️ Why a token and not the merchant id: the widget's webhook URL is set in the merchant's browser, and
 * Ramp's host key is public, so whoever opens the widget chooses what that URL says. With a merchant id in
 * it, anyone who knew another merchant's id could file their own real sale in that merchant's Activity.
 * The token is 160 random bits that only its own merchant's dashboard is ever given.
 */
export async function merchantForWebhookToken(db: Db, token: string | undefined): Promise<string | null> {
  if (!token || !WEBHOOK_TOKEN.test(token)) return null;
  const m = await db.merchant.findUnique({ where: { rampWebhookToken: token }, select: { id: true } });
  return m?.id ?? null;
}

/** The merchant's webhook token, made on first use. Two first requests at once still agree on one token. */
export async function webhookTokenFor(db: Db, merchantId: string): Promise<string> {
  const current = await db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { rampWebhookToken: true } });
  if (current.rampWebhookToken) return current.rampWebhookToken;
  // Only fills an empty slot, so a concurrent request that got there first keeps its token.
  await db.merchant.updateMany({ where: { id: merchantId, rampWebhookToken: null }, data: { rampWebhookToken: newWebhookToken() } });
  const after = await db.merchant.findUniqueOrThrow({ where: { id: merchantId }, select: { rampWebhookToken: true } });
  return after.rampWebhookToken!;
}

export async function listRampSales(db: Db, merchantId: string, cursor: string | undefined, limit = 20) {
  const rows = await db.rampSale.findMany({
    where: { merchantId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { page, hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}

export function toRampSale(s: RampSale): z.output<typeof S.RampSale> {
  return {
    id: s.id,
    status: s.status,
    crypto: { asset: s.cryptoSymbol, chain: s.cryptoChain, amount: amount(s.cryptoAmount) },
    fiat: { currency: s.fiatCurrency, amount: amount(s.fiatAmount) },
    payout_method: s.payoutMethod,
    tx_hash: s.transactionHash,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}
