import { z } from "zod";

/**
 * NEAR Intents 1Click API shapes (https://docs.near-intents.org, checked against the live API on 2026-11-14).
 * Parsed rather than trusted: if a field changes we fail here, loudly, not by writing garbage to the database.
 */

export const Token = z.looseObject({
  assetId: z.string(),
  symbol: z.string(),
  blockchain: z.string(),
  decimals: z.number(),
  price: z.number().nullish(),
});
export type Token = z.infer<typeof Token>;
export const TokenList = z.array(Token);

export type QuoteRequest = {
  /** A dry quote simulates only: no deposit address is made. */
  dry: boolean;
  originAsset: string;
  destinationAsset: string;
  /** Whole number, in the origin asset's smallest unit. */
  amount: string;
  recipient: string;
  refundTo: string;
  /** ISO time the quote (and its deposit address) stops being valid. */
  deadline: string;
};

export const QuoteResponse = z.looseObject({
  correlationId: z.string().optional(),
  signature: z.string().optional(),
  quote: z.looseObject({
    amountIn: z.string(),
    amountOut: z.string(),
    amountOutFormatted: z.string().optional(),
    minAmountOut: z.string().optional(),
    timeEstimate: z.number().optional(),
    depositAddress: z.string().optional(),
    deadline: z.string().optional(),
  }),
});
export type QuoteResponse = z.infer<typeof QuoteResponse>;

/** What 1Click calls the stages of one swap. SUCCESS is the only delivered state. REFUNDED and FAILED never deliver. */
export const SWAP_STATES = ["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"] as const;
export type SwapState = (typeof SWAP_STATES)[number];

export const StatusResponse = z.looseObject({
  correlationId: z.string().optional(),
  // An unknown future state must not crash the tracker: the caller reads it as "still going".
  status: z.string(),
  swapDetails: z
    .looseObject({
      amountOut: z.string().optional(),
      amountOutFormatted: z.string().optional(),
      destinationChainTxHashes: z.array(z.looseObject({ hash: z.string().optional(), explorerUrl: z.string().optional() })).optional(),
      refundedAmount: z.string().optional(),
    })
    .optional(),
});
export type StatusResponse = z.infer<typeof StatusResponse>;
