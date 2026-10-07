import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import { CHAINS, SETTLEMENT_CHAIN } from "../aurora/chains.js";
import { AuroraError, type AuroraClient } from "../aurora/client.js";
import type { Db } from "../db/client.js";
import { Prisma, type Invoice, type InvoiceAddress, type Merchant } from "../generated/prisma/client.js";
import { ApiError } from "../lib/errors.js";
import { checkoutToken, eventId, invoiceId } from "../lib/ids.js";

/**
 * The standing deposit address: one permanent address a merchant can hand out,
 * with no invoice behind each payment.
 *
 * It is stored as ONE long-lived Invoice of kind STANDING, with one
 * InvoiceAddress. That is deliberate: the poller, Payment rows, balance,
 * Activity list and webhooks already work from invoices, so a deposit to this
 * address becomes an ordinary Payment with no new machinery. What differs is
 * only that the invoice is never judged against an amount and never expires
 * (see the poller), and that every deposit is its own payment.
 *
 * Aurora's address is fixed to a recipient when it is minted, so the standing
 * invoice is keyed by the settlement address and asset it was minted for. If a
 * merchant later changes either, the next call mints a new address for the new
 * recipient and the old one keeps being watched: money sent to it still lands
 * in the old wallet, and still has to show up.
 *
 * Only EVM is offered. One address serves every EVM chain (verified live), and
 * that family is the one proven end to end with a real deposit. Other families
 * would each need their own address and their own polling.
 */

export type StandingDeps = {
  db: Db;
  aurora: Pick<AuroraClient, "mintAddress">;
};

export const STANDING_FAMILY = "evm";
const STANDING_CHAINS = CHAINS.filter((c) => c.family === STANDING_FAMILY).map((c) => c.id);

/** Far enough away that it never expires, and still a valid timestamp everywhere. */
const NEVER = new Date("2100-01-01T00:00:00.000Z");

type Standing = Invoice & { addresses: InvoiceAddress[] };

export function standingReference(settlementAddress: string, asset: string): string {
  return `standing:${asset}:${settlementAddress.toLowerCase()}`;
}

/** The standing address for the merchant's CURRENT settlement setup, if one exists. */
export async function findStanding(db: Db, merchant: Merchant): Promise<Standing | null> {
  if (!merchant.settlementAddress || !merchant.settlementVerified) return null;
  const reference = standingReference(merchant.settlementAddress, merchant.settlementAsset ?? "USDC");
  const invoice = await db.invoice.findUnique({
    where: { merchantId_reference: { merchantId: merchant.id, reference } },
    include: { addresses: true },
  });
  return invoice?.kind === "STANDING" ? invoice : null;
}

/**
 * Returns the merchant's standing address, creating it the first time.
 * Idempotent: Aurora returns the same address for the same inputs, and a race
 * between two creates resolves on the unique (merchant, reference) index.
 */
export async function ensureStanding(deps: StandingDeps, merchant: Merchant): Promise<Standing> {
  if (!merchant.settlementAddress || !merchant.settlementVerified) {
    throw new ApiError(
      409,
      "settlement_not_verified",
      "Set and verify a settlement address before getting a deposit address. Payments cannot be routed to an unverified address.",
    );
  }
  const existing = await findStanding(deps.db, merchant);
  if (existing) return existing;

  const asset = merchant.settlementAsset ?? "USDC";
  const id = invoiceId();
  const sender = `standing:${merchant.id}`;

  let address: string;
  try {
    const res = await deps.aurora.mintAddress({
      recipient: merchant.settlementAddress,
      sender,
      depositChain: STANDING_FAMILY,
      destinationChain: SETTLEMENT_CHAIN,
      destinationAsset: asset,
    });
    // A memo-bearing address would lose funds sent without it; EVM never has one.
    if (res.memo) throw new AuroraError("bad_request", "standing address unexpectedly requires a memo");
    address = res.depositAddress;
  } catch (err) {
    if (err instanceof AuroraError) {
      throw new ApiError(502, "upstream", "Could not create a deposit address right now. Nothing was charged; try again.");
    }
    throw err;
  }

  const reference = standingReference(merchant.settlementAddress, asset);
  try {
    return await deps.db.invoice.create({
      data: {
        id,
        token: checkoutToken(),
        merchantId: merchant.id,
        reference,
        kind: "STANDING",
        amountExpected: 0,
        currency: "USD",
        chains: STANDING_CHAINS,
        expiresAt: NEVER,
        addresses: { create: [{ family: STANDING_FAMILY, address, auroraSender: sender }] },
        events: { create: { id: eventId(), status: "PENDING", note: "standing deposit address created" } },
      },
      include: { addresses: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await findStanding(deps.db, merchant);
      if (winner) return winner;
    }
    throw err;
  }
}

/** The wire shape: the address, where it settles, and the chains it accepts (with minimums when measured). */
export function toDepositAddress(
  standing: Standing,
  merchant: Pick<Merchant, "settlementAddress" | "settlementAsset">,
  minimums?: Map<string, string>,
): z.output<typeof S.DepositAddress> {
  const address = standing.addresses.find((a) => a.family === STANDING_FAMILY)?.address ?? "";
  const live = minimums && minimums.size > 0;
  return {
    address,
    asset: merchant.settlementAsset ?? "USDC",
    settles_to: merchant.settlementAddress ?? "",
    // With a measured catalogue, only promise the chains Aurora is actually quoting right now.
    chains: standing.chains
      .filter((chain) => !live || minimums.has(chain))
      .map((chain) => {
        const minimum = minimums?.get(chain);
        return minimum ? { chain, minimum } : { chain };
      }),
  };
}
