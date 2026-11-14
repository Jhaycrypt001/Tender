import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Merchant } from "../generated/prisma/client.js";
import type { Db } from "../db/client.js";
import { ApiError, notFound, validation } from "../lib/errors.js";
import { NearIntentsError, type NearIntentsClient } from "../near/client.js";
import { isNearAccountId, NEAR_ROUTE, nearRoutes } from "../near/route.js";
import { getTransfer, prepareTransfer, quoteTransfer, submitTransfer, type TransferDeps } from "./transfer.service.js";

/**
 * Paying out to a NEAR account through NEAR Intents, DIRECT. Separate from the Aurora-backed 30-chain payout:
 * the quote, the one-off deposit address and the delivery tracking all come from Tender's own NEAR Intents client
 * (src/near/), and nothing here calls Aurora.
 *
 * What it reuses, on purpose, is everything that makes a payout safe: the wallet-balance and daily-limit checks, the
 * EIP-3009 authorization only the merchant's wallet can sign, the relayer and the chain confirmation. Those are the
 * same for every payout. The recipient's NEAR account is kept on the transfer line and is what the signing prompt
 * shows; the signed transfer itself goes to the one-off Monad address NEAR Intents made for this quote.
 *
 * Non-custodial, as everywhere else: these functions plan and relay. Only the merchant's wallet can authorize.
 */

export type NearTransferDeps = Omit<TransferDeps, "near"> & { nearClient: Pick<NearIntentsClient, "tokens" | "quote" | "status"> };

/** The transfer deps with NEAR Intents standing in for Aurora, and every line made marked as such. */
function direct(deps: NearTransferDeps): TransferDeps {
  const { nearClient, ...rest } = deps;
  return { ...rest, aurora: nearRoutes(nearClient, deps.now), routeName: NEAR_ROUTE };
}

/**
 * NEAR Intents being unreachable is a "try again", never a verdict on the payout. A refused key or request is NOT: retrying
 * cannot fix it, so it is a different code (and logged at error level), and the merchant is not told to keep trying.
 * Nothing has been sent at this point either way.
 */
async function viaNear<T>(deps: Pick<TransferDeps, "logger">, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (!(err instanceof NearIntentsError)) throw err;
    if (err.kind === "auth") {
      deps.logger?.error({ kind: err.kind, status: err.status, err: err.message }, "NEAR Intents refused our credentials; payouts to NEAR are off until the key is fixed");
      throw new ApiError(502, "near_misconfigured", "Paying out to NEAR is not working right now. Nothing was sent. Tender has been told.");
    }
    if (err.kind === "bad_request") {
      deps.logger?.warn({ kind: err.kind, status: err.status, err: err.message }, "NEAR Intents refused a payout request");
      throw new ApiError(502, "route_failed", "NEAR Intents would not take this payout. Nothing was sent.");
    }
    deps.logger?.warn({ kind: err.kind, status: err.status, err: err.message }, "NEAR Intents could not be reached for a payout");
    throw new ApiError(503, "near_unavailable", "NEAR Intents is not reachable right now. Nothing was sent. Try again in a moment.");
  }
}

/** Payouts prepared but not yet signed, per merchant. Each one holds a live deposit address at NEAR Intents. */
const MAX_UNSIGNED = 10;

const BAD_ACCOUNT = "That is not a valid NEAR account (for example alice.near, or a 64-character hex address).";

/** A dry run: would NEAR Intents take this, and roughly what would the recipient get? Moves and creates nothing. */
export async function quoteNearTransfer(deps: NearTransferDeps, merchant: Merchant, input: { to: string; amount: string }): Promise<z.output<typeof S.QuoteTransferResult>> {
  if (!isNearAccountId(input.to)) return { ok: false, field: "to", message: BAD_ACCOUNT };
  return viaNear(deps, () => quoteTransfer(direct(deps), merchant, { dest_chain: "near", to: input.to, amount: input.amount }));
}

/** Step 1: validate and return what the wallet must sign. Moves nothing. */
export async function prepareNearTransfer(deps: NearTransferDeps, merchant: Merchant, input: { to: string; amount: string; note?: string }) {
  if (!isNearAccountId(input.to)) throw validation({ "lines.0.to": BAD_ACCOUNT });
  // Every prepare makes a live deposit address at NEAR Intents, on Tender's shared key. A merchant who keeps preparing
  // without ever signing (a script, a double-click) must not be able to spend that allowance or leave a pile behind.
  const unsigned = await deps.db.transfer.count({
    where: { merchantId: merchant.id, status: "AWAITING_SIGNATURE", expiresAt: { gt: (deps.now ?? (() => new Date()))() }, lines: { some: { route: NEAR_ROUTE } } },
  });
  if (unsigned >= MAX_UNSIGNED) throw new ApiError(429, "too_many_pending", "You have several NEAR payouts waiting for your signature. Sign or let them expire (15 minutes) first.");
  return viaNear(deps, () =>
    prepareTransfer(direct(deps), merchant, { kind: "PAYOUT", lines: [{ to: input.to, amount: input.amount, dest_chain: "near" }], note: input.note }),
  );
}

/** Step 2 is the ordinary one (the wallet's signatures, then the relayer): only a NEAR-direct transfer is accepted here. */
export async function submitNearTransfer(deps: NearTransferDeps, merchant: Merchant, id: string, signatures: string[]) {
  await getNearTransfer(deps.db, merchant.id, id);
  return submitTransfer(deps, merchant, id, signatures);
}

/** One NEAR-direct transfer. An id that belongs to another kind of transfer is not found here. */
export async function getNearTransfer(db: Db, merchantId: string, id: string) {
  const transfer = await getTransfer(db, merchantId, id);
  if (!transfer.lines.some((l) => l.route === NEAR_ROUTE)) throw notFound("Transfer");
  return transfer;
}
