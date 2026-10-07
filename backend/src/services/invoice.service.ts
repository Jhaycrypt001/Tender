import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import { DEFAULT_CHAINS, SETTLEMENT_CHAIN, chainById, familiesFor } from "../aurora/chains.js";
import { AuroraError, type AuroraClient } from "../aurora/client.js";
import type { Db } from "../db/client.js";
import { Prisma, type InvoiceStatus, type Merchant } from "../generated/prisma/client.js";
import { ApiError, conflict, notFound, validation } from "../lib/errors.js";
import { checkoutToken, eventId, invoiceId } from "../lib/ids.js";
import { Decimal } from "../lib/money.js";

export type InvoiceDeps = {
  db: Db;
  aurora: Pick<AuroraClient, "mintAddress">;
  ttlMinutes: number;
};

type CreateInput = z.output<typeof S.CreateInvoiceInput>;

/**
 * Settlement is in USDC on Monad, judged 1:1 against the invoice amount, so
 * only dollar-denominated invoices are truthful today. Other currencies need
 * an FX source, which is out of scope (BACKEND.md §14).
 */
const SUPPORTED_CURRENCIES = new Set(["USD", "USDC"]);

const MAX_AMOUNT = "1000000000000";

const withAddresses = { addresses: true } as const;

/**
 * Creates an invoice and mints its deposit addresses.
 *
 * Idempotent on (merchant, reference): a retried create returns the original
 * invoice with `created: false`. The same reference with a different amount
 * or currency is a conflict, never a silent overwrite.
 *
 * Addresses are minted BEFORE anything is written. If Aurora fails, nothing
 * is persisted and the merchant can simply retry. If two identical creates
 * race, both mint (harmless — unused addresses cost nothing), one insert wins
 * on the unique index, and the loser returns the winner's invoice.
 */
export async function createInvoice(deps: InvoiceDeps, merchant: Merchant, input: CreateInput) {
  const currency = input.currency.toUpperCase();
  if (!SUPPORTED_CURRENCIES.has(currency)) {
    throw validation({ currency: `must be one of ${[...SUPPORTED_CURRENCIES].join(", ")}` });
  }

  // Decimal(36,18) holds 18 integer digits; reject rather than overflow in Postgres.
  if (new Decimal(input.amount_expected).gte(MAX_AMOUNT)) {
    throw validation({ amount_expected: "is too large" });
  }

  const chains = [...new Set(input.chains ?? DEFAULT_CHAINS)];
  const unknown = chains.filter((c) => !chainById(c));
  if (unknown.length) throw validation({ chains: `unsupported: ${unknown.join(", ")}` });

  if (!merchant.settlementAddress || !merchant.settlementVerified) {
    throw new ApiError(
      409,
      "settlement_not_verified",
      "Set and verify a settlement address before creating invoices. Payments cannot be routed to an unverified address.",
    );
  }

  const existing = await findByReference(deps.db, merchant.id, input.reference);
  if (existing) return { invoice: sameOrConflict(existing, input.amount_expected, currency), created: false };

  const id = invoiceId();
  const addresses = await mintAll(deps.aurora, {
    invoiceId: id,
    families: familiesFor(chains),
    recipient: merchant.settlementAddress,
    asset: merchant.settlementAsset ?? "USDC",
  });

  try {
    const invoice = await deps.db.invoice.create({
      data: {
        id,
        token: checkoutToken(),
        merchantId: merchant.id,
        reference: input.reference,
        amountExpected: input.amount_expected,
        currency,
        chains,
        expiresAt: new Date(Date.now() + deps.ttlMinutes * 60_000),
        redirectUrl: input.redirect_url ?? null,
        metadata: (input.metadata as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
        addresses: { create: addresses.map((a) => ({ family: a.family, address: a.address, auroraSender: id })) },
        events: { create: { id: eventId(), status: "PENDING", note: "created" } },
      },
      include: withAddresses,
    });
    return { invoice, created: true };
  } catch (err) {
    if (isUniqueViolation(err)) {
      const winner = await findByReference(deps.db, merchant.id, input.reference);
      if (winner) return { invoice: sameOrConflict(winner, input.amount_expected, currency), created: false };
    }
    throw err;
  }
}

export async function getInvoice(db: Db, merchantId: string, id: string) {
  const invoice = await db.invoice.findFirst({
    where: { id, merchantId },
    include: { addresses: true, payments: { orderBy: { firstSeenAt: "asc" } } },
  });
  if (!invoice) throw notFound("Invoice");
  return invoice;
}

export async function listInvoices(db: Db, merchantId: string, query: z.output<typeof S.ListInvoicesQuery>) {
  const limit = query.limit ?? 20;
  const rows = await db.invoice.findMany({
    where: { merchantId, kind: "STANDARD", ...statusFilter(query.status) },
    include: withAddresses,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { page, hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}

/** Only an unpaid, unexpired invoice can be cancelled. Terminal states never move. */
export async function cancelInvoice(db: Db, merchantId: string, id: string) {
  return db.$transaction(async (tx) => {
    const { count } = await tx.invoice.updateMany({
      where: { id, merchantId, kind: "STANDARD", status: "PENDING", expiresAt: { gt: new Date() } },
      data: { status: "CANCELLED" },
    });
    if (count === 0) {
      const invoice = await tx.invoice.findFirst({ where: { id, merchantId }, select: { status: true } });
      if (!invoice) throw notFound("Invoice");
      throw conflict("Only a pending invoice can be cancelled");
    }
    await tx.invoiceEvent.create({ data: { id: eventId(), invoiceId: id, status: "CANCELLED", note: "cancelled by merchant" } });
    return tx.invoice.findUniqueOrThrow({ where: { id }, include: withAddresses });
  });
}

const TOKEN_PATTERN = /^chk_[0-9A-Za-z]{27}$/;

/** The checkout page's read. A malformed token is a 404 without touching the database. */
export async function getPublicInvoice(db: Db, token: string) {
  if (!TOKEN_PATTERN.test(token)) throw notFound("Invoice");
  const invoice = await db.invoice.findUnique({
    where: { token },
    include: { addresses: true, merchant: { select: { name: true } } },
  });
  // A standing deposit address has no checkout page: it is not a bill.
  if (!invoice || invoice.kind === "STANDING") throw notFound("Invoice");
  return invoice;
}

/* -------------------------------------------------------------------------- */

async function mintAll(
  aurora: InvoiceDeps["aurora"],
  args: { invoiceId: string; families: string[]; recipient: string; asset: string },
) {
  try {
    // ONE AT A TIME. Aurora serialises address creation per `sender`: a second
    // mint for the same invoice while one is running is answered 429 "A concurrent
    // request is creating this deposit address". Fired in parallel, the last family
    // ran out of its 3 retries and the whole invoice failed with a 502 (seen live,
    // 2026-10-02). Sequential costs about half a second per family and cannot collide.
    const minted: { family: string; address: string }[] = [];
    for (const family of args.families) {
      const res = await aurora.mintAddress({
        recipient: args.recipient,
        // The invoice id as `sender` gives every invoice its own addresses (constraint #6).
        sender: args.invoiceId,
        depositChain: family,
        destinationChain: SETTLEMENT_CHAIN,
        destinationAsset: args.asset,
      });
      // A memo-bearing chain would lose funds sent without it, and the contract cannot carry one.
      if (res.memo) throw new AuroraError("bad_request", `family ${family} requires a memo; not supported`);
      minted.push({ family, address: res.depositAddress });
    }
    return minted;
  } catch (err) {
    if (err instanceof AuroraError) {
      throw new ApiError(502, "upstream", "Could not create deposit addresses right now. Nothing was charged; retry the request.");
    }
    throw err;
  }
}

function findByReference(db: Db, merchantId: string, reference: string) {
  return db.invoice.findUnique({
    where: { merchantId_reference: { merchantId, reference } },
    include: withAddresses,
  });
}

function sameOrConflict<T extends { amountExpected: Prisma.Decimal; currency: string }>(invoice: T, amount: string, currency: string): T {
  const same = new Decimal(invoice.amountExpected.toString()).eq(amount) && invoice.currency === currency;
  if (!same) throw conflict("An invoice with this reference already exists with a different amount or currency");
  return invoice;
}

/** Matches `effectiveStatus`: an overdue PENDING invoice lists as EXPIRED. */
function statusFilter(status: InvoiceStatus | undefined): Prisma.InvoiceWhereInput {
  const now = new Date();
  if (status === "PENDING") return { status: "PENDING", expiresAt: { gt: now } };
  if (status === "EXPIRED") return { OR: [{ status: "EXPIRED" }, { status: "PENDING", expiresAt: { lte: now } }] };
  return status ? { status } : {};
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
