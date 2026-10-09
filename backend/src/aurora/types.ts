import { z } from "zod";

/**
 * Aurora response shapes, from the published OpenAPI spec and checked against
 * live responses on 2026-09-26. Parsed rather than trusted: if Aurora changes
 * a field, we fail loudly here instead of writing garbage to the database.
 */

export const MintResponse = z.object({
  depositAddress: z.string().min(1),
  alreadyExists: z.boolean(),
  memo: z.string().optional(),
  correlationId: z.string().optional(),
});
export type MintResponse = z.infer<typeof MintResponse>;

export const Deposit = z.object({
  tx_hash: z.string(),
  fromChain: z.string().nullish(),
  destinationChain: z.string().nullish(),
  asset_id: z.string().nullable(),
  decimals: z.number().nullable(),
  /** Base units, as a string. */
  amount: z.string(),
  from: z.string().optional(),
  created_at: z.string(),
  intents_account: z.string(),
  deposit_address: z.string(),
  recipient: z.string(),
});
export type Deposit = z.infer<typeof Deposit>;

export const DepositStatusResponse = z.object({ deposits: z.array(Deposit) });

/** Which list to read: reached Aurora / paid out / payout failed. */
export type DepositListType = "received" | "success" | "failed";

export const Token = z.looseObject({
  assetId: z.string(),
  symbol: z.string(),
  blockchain: z.string(),
  decimals: z.number(),
  price: z.number().nullish(),
});
export type Token = z.infer<typeof Token>;

export const TokensResponse = z.looseObject({ tokens: z.array(Token) });

/** A dry-run quote. Used only to measure per-chain minimums and settlement times. */
export const QuoteResponse = z.looseObject({
  quote: z.looseObject({
    amountIn: z.string(),
    minAmountIn: z.string().optional(),
    amountInUsd: z.string().optional(),
    amountOutFormatted: z.string().optional(),
    amountOutUsd: z.string().optional(),
    /** Seconds from deposit to delivery. */
    timeEstimate: z.number().optional(),
  }),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;
