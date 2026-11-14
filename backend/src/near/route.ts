import { randomUUID } from "node:crypto";
import type { RouteQuote } from "../aurora/client.js";
import { NearIntentsClient, NearIntentsError } from "./client.js";
import type { Token } from "./types.js";

/**
 * NEAR Intents, direct, shaped like the route the transfer service already knows how to use.
 *
 * A payout to another chain is: quote it, make a one-off Monad deposit address that delivers it, have the merchant's
 * wallet sign a plain Monad transfer to that address, then follow the delivery. The transfer service does all of that
 * and does not care who made the address. This file is that "who", with NEAR Intents' own API instead of Aurora.
 */

/** Stored on a transfer line, so the delivery tracker asks the right service. Null on a line means Aurora. */
export const NEAR_ROUTE = "near-intents";

/** How long a deposit address stays valid. Longer than a signing window (15 min), so a slow signer is never cut off. */
const ADDRESS_TTL_MS = 60 * 60_000;
const QUOTE_TTL_MS = 10 * 60_000;

/** A NEAR account: a named one ("alice.near", "shop.alice.tg"), a 64-hex implicit one, or an EVM-style implicit one. */
export function isNearAccountId(id: string): boolean {
  if (/^[0-9a-f]{64}$/.test(id) || /^0x[0-9a-fA-F]{40}$/.test(id)) return true;
  if (id.length < 2 || id.length > 64) return false;
  return /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id);
}

export type NearMintHint = { amountBase?: string; refundTo?: string; originAsset?: string };

/** The three calls checkRoute/mintRoute make, answered by NEAR Intents. Same results as the Aurora client gives. */
export function nearRoutes(client: Pick<NearIntentsClient, "tokens" | "quote">, now: () => Date = () => new Date()) {
  return {
    provider: NEAR_ROUTE,

    async tokens(): Promise<Token[]> {
      return client.tokens();
    },

    async routeQuote(input: { originAsset: string; destinationAsset: string; amount: string; recipient: string; refundTo: string }): Promise<RouteQuote> {
      if (!isNearAccountId(input.recipient)) return { ok: false, reason: "invalid_recipient" };
      try {
        const res = await client.quote({ ...input, dry: true, deadline: new Date(now().getTime() + QUOTE_TTL_MS).toISOString() });
        return { ok: true, amountOut: res.quote.amountOutFormatted ?? null, seconds: res.quote.timeEstimate ?? null };
      } catch (err) {
        if (!(err instanceof NearIntentsError) || err.kind !== "bad_request") throw err;
        // 1Click answers 400 for every refusal and gives the cause only in the text.
        if (/too low|minimum/i.test(err.message)) {
          const atLeast = /at least (\d+)/i.exec(err.message);
          return { ok: false, reason: "below_minimum", minimumBaseUnits: atLeast ? atLeast[1]! : null };
        }
        if (/recipient|invalid|not valid/i.test(err.message)) return { ok: false, reason: "invalid_recipient" };
        return { ok: false, reason: "unavailable" };
      }
    },

    /**
     * 1Click's deposit address belongs to one quote: it needs the amount and where a refund goes. The transfer service
     * supplies both as a hint (Aurora's persistent addresses need neither, so its client never sees them).
     */
    async mintAddress(
      input: { recipient: string; sender: string; depositChain: string; destinationChain: string; destinationAsset: string },
      hint: NearMintHint = {},
    ): Promise<{ depositAddress: string; alreadyExists: boolean; correlationId?: string }> {
      if (!hint.amountBase || !hint.refundTo || !hint.originAsset) throw new NearIntentsError("bad_request", "a deposit address needs the amount, the origin asset and a refund address");
      const res = await client.quote({
        dry: false,
        originAsset: hint.originAsset,
        destinationAsset: input.destinationAsset,
        amount: hint.amountBase,
        recipient: input.recipient,
        refundTo: hint.refundTo,
        deadline: new Date(now().getTime() + ADDRESS_TTL_MS).toISOString(),
      });
      return { depositAddress: res.quote.depositAddress!, alreadyExists: false, correlationId: res.correlationId ?? randomUUID() };
    },
  };
}

export type Delivery = "delivered" | "failed" | "pending";

/**
 * Where a payout's delivery stands. Only SUCCESS is delivered; REFUNDED and FAILED will not deliver. Everything else,
 * including a state this code has never heard of and a deposit address 1Click does not know yet, is still going: the
 * tracker looks again rather than guess.
 */
export function nearDelivery(client: Pick<NearIntentsClient, "status">): (depositAddress: string) => Promise<Delivery> {
  return async (depositAddress) => {
    const s = await client.status(depositAddress);
    if (!s) return "pending";
    if (s.state === "SUCCESS") return "delivered";
    if (s.state === "REFUNDED" || s.state === "FAILED") return "failed";
    return "pending";
  };
}
