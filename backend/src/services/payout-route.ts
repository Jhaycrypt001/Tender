import { randomUUID } from "node:crypto";
import { isAddress } from "viem";
import type { AuroraClient, RouteQuote } from "../aurora/client.js";
import { CHAINS, chainById, SETTLEMENT_CHAIN, type ChainInfo } from "../aurora/chains.js";
import type { Token } from "../aurora/types.js";
import { ApiError, validation } from "../lib/errors.js";
import { Decimal } from "../lib/money.js";
import type { TokenInfo } from "../lib/tokens.js";

/**
 * Sending money to ANOTHER chain from the merchant's Monad wallet, carried by Aurora.
 *
 * The merchant's wallet still signs an ordinary Monad transfer. The only difference is
 * where it goes: not the recipient, but a one-off Aurora deposit address on Monad that
 * Aurora minted for this payout and pointed at the recipient on the destination chain.
 * Aurora sees the deposit, swaps if needed and delivers. So the signed authorization, the
 * relayer and the chain reconciliation are exactly the ones a plain transfer uses.
 *
 * What the recipient gets: a stablecoin where the chain has one (USDC, then USDT, then
 * USDT0), otherwise the chain's own coin. The merchant is told which, and roughly how much.
 *
 * ⚠️ Nothing here can carry a memo or destination tag: Aurora's quote has no field for one.
 * On chains where exchanges need them (XRP, TON) the screen says so; the server only flags it.
 */

type AuroraRoute = Pick<AuroraClient, "tokens" | "routeQuote" | "mintAddress">;

export type PayoutChain = {
  id: string;
  name: string;
  /** What the recipient receives, e.g. "USDC" or "BTC". */
  asset: string;
  /** True when sending to an exchange deposit address would need a memo or tag that cannot be attached. */
  memo_risk: boolean;
};

/** Chains whose exchange deposit addresses are shared and told apart by a memo or tag. */
const MEMO_RISK = new Set(["xrp", "ton"]);
const STABLES = ["USDC", "USDT", "USDT0"];

type Destination = { chain: ChainInfo; token: Token };

const TOKEN_TTL_MS = 5 * 60_000;
let cache: { at: number; tokens: Token[] } | null = null;

async function listTokens(aurora: Pick<AuroraClient, "tokens">): Promise<Token[]> {
  if (cache && Date.now() - cache.at < TOKEN_TTL_MS) return cache.tokens;
  const tokens = await aurora.tokens();
  cache = { at: Date.now(), tokens };
  return tokens;
}

/** The asset the recipient receives on one chain: a stablecoin if it lists one, else the chain's own coin. */
function destinationFor(chain: ChainInfo, tokens: Token[]): Token | null {
  const here = tokens.filter((t) => t.blockchain === chain.aurora);
  for (const symbol of [...STABLES, chain.asset]) {
    const found = here.find((t) => t.symbol === symbol);
    if (found) return found;
  }
  return null;
}

/** Every chain a payout can reach (all of them except Monad), with what the recipient receives. */
export async function payoutChains(aurora: Pick<AuroraClient, "tokens">): Promise<PayoutChain[]> {
  const tokens = await listTokens(aurora);
  const out: PayoutChain[] = [];
  for (const chain of CHAINS) {
    if (chain.id === SETTLEMENT_CHAIN) continue;
    const token = destinationFor(chain, tokens);
    if (token) out.push({ id: chain.id, name: chain.name, asset: token.symbol, memo_risk: MEMO_RISK.has(chain.id) });
  }
  return out;
}

export type RouteCheck =
  | { ok: true; chain: ChainInfo; destination: Token; origin: Token; expectedOut: string | null; seconds: number | null }
  | { ok: false; field: "to" | "amount" | "chain"; message: string };

/** Everything short of minting: is this a route Aurora will take, and what will the recipient get? */
export async function checkRoute(
  aurora: AuroraRoute,
  input: { chainId: string; to: string; amount: string; from: string; token: TokenInfo },
): Promise<RouteCheck> {
  const chain = chainById(input.chainId);
  if (!chain || chain.id === SETTLEMENT_CHAIN) return { ok: false, field: "chain", message: "That chain is not available for sending." };

  const tokens = await listTokens(aurora);
  const destination = destinationFor(chain, tokens);
  const origin = tokens.find((t) => t.blockchain === "monad" && t.symbol === input.token.symbol);
  if (!destination || !origin) return { ok: false, field: "chain", message: `Sending to ${chain.name} is not available right now.` };

  const units = new Decimal(input.amount).mul(new Decimal(10).pow(origin.decimals));
  if (!units.isInteger() || units.lte(0)) return { ok: false, field: "amount", message: "Enter an amount above zero." };

  const quote: RouteQuote = await aurora.routeQuote({
    originAsset: origin.assetId,
    destinationAsset: destination.assetId,
    amount: units.toFixed(0),
    recipient: input.to,
    refundTo: input.from,
  });

  if (quote.ok) return { ok: true, chain, destination, origin, expectedOut: quote.amountOut, seconds: quote.seconds };
  switch (quote.reason) {
    case "below_minimum": {
      const min = quote.minimumBaseUnits ? new Decimal(quote.minimumBaseUnits).div(new Decimal(10).pow(origin.decimals)).toFixed() : null;
      return { ok: false, field: "amount", message: min ? `Too small to send to ${chain.name}. The smallest amount is ${min} ${origin.symbol}.` : `Too small to send to ${chain.name}.` };
    }
    case "invalid_recipient":
      return { ok: false, field: "to", message: `That is not a valid ${chain.name} address.` };
    case "no_trustline":
      return { ok: false, field: "to", message: `That ${chain.name} account cannot receive ${destination.symbol} yet. It has to add the asset first.` };
    default:
      return { ok: false, field: "chain", message: `Sending to ${chain.name} is not available right now. Try again later.` };
  }
}

/** Mints the one-off Monad address that delivers to `to`. A fresh sender each time, so no two payouts share an address. */
export async function mintRoute(aurora: AuroraRoute, route: Extract<RouteCheck, { ok: true }>, to: string): Promise<string> {
  const minted = await aurora.mintAddress({
    recipient: to,
    sender: `payout:${randomUUID()}`,
    // Monad is an EVM chain: Aurora mints per address family, and every EVM chain shares one.
    depositChain: "evm",
    destinationChain: route.chain.aurora,
    destinationAsset: route.destination.assetId,
  });
  if (!isAddress(minted.depositAddress)) {
    throw new ApiError(502, "route_failed", "Could not set up that route. Nothing was sent.");
  }
  return minted.depositAddress;
}

/** The same checks as a form field error: the message goes under the field that caused it. */
export function routeFailure(check: Extract<RouteCheck, { ok: false }>, index = 0): never {
  if (check.field === "to") throw validation({ [`lines.${index}.to`]: check.message });
  if (check.field === "amount") throw validation({ [`lines.${index}.amount`]: check.message });
  throw new ApiError(409, "route_unavailable", check.message);
}
