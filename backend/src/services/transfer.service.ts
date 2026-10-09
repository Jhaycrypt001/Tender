import { randomBytes } from "node:crypto";
import { getAddress, isAddress, recoverTypedDataAddress, zeroAddress, type Hex } from "viem";
import type * as S from "../../contract/schemas.js";
import type { z } from "zod";
import type { Db } from "../db/client.js";
import type { Merchant, Prisma } from "../generated/prisma/client.js";
import { ApiError, conflict, notFound, validation } from "../lib/errors.js";
import { Decimal, isAmount } from "../lib/money.js";
import { MONAD_CHAIN_ID, MULTICALL3, TRANSFER_WITH_AUTHORIZATION_TYPES, tokenFor, type TokenInfo } from "../lib/tokens.js";
import type { AuroraClient } from "../aurora/client.js";
import { SETTLEMENT_CHAIN, chainById } from "../aurora/chains.js";
import { amount } from "./serialize.js";
import { checkRoute, mintRoute, payoutChains, routeFailure } from "./payout-route.js";
import { TransferRejected, type SignedLine, type TransferChain } from "./transfer-chain.js";

/**
 * Sending money OUT of a merchant's own wallet: payouts, refunds and splits.
 *
 * ── How it stays non-custodial ─────────────────────────────────────────────
 * Tender never holds these funds and never signs for the merchant. For each
 * recipient the merchant's WALLET signs an EIP-3009 authorization: "send
 * exactly this much, to this address, before this time". The signature covers
 * every one of those fields, so whoever submits it can change none of them.
 * Tender's relayer submits it and pays the gas; if it never does, it expires.
 * A split is several authorizations in ONE Multicall3 transaction, so it lands
 * whole or not at all.
 *
 * ── What it never does ─────────────────────────────────────────────────────
 * It never says money moved because a browser said so. A transfer is CONFIRMED
 * only when the chain shows a successful receipt AND every authorization nonce
 * is used up on the token contract.
 */

export type TransferConfig = {
  dailyLimit: number;
  maxLines: number;
  /** Refuse to relay when the relayer holds less MON than this, in wei. */
  minRelayerWei: bigint;
};

export type TransferDeps = {
  db: Db;
  chain: TransferChain | undefined;
  /** Needed only to send to another chain, and to follow that delivery. Without it such a transfer is refused. */
  aurora?: Partial<Pick<AuroraClient, "tokens" | "routeQuote" | "mintAddress" | "deposits">>;
  config: TransferConfig;
  now?: () => Date;
};

/** How long a signed authorization stays valid. Long enough to review and sign a split, short enough to be harmless if lost. */
export const AUTHORIZATION_TTL_MS = 15 * 60_000;
/** A relayed transaction not mined this long after the deadline is given up on. */
const STUCK_AFTER_MS = 10 * 60_000;

type TransferWithLines = Prisma.TransferGetPayload<{ include: { lines: true } }>;
type PrepareInput = z.output<typeof S.PrepareTransferBody>;
type Wire = z.output<typeof S.Transfer>;

const clock = (deps: Pick<TransferDeps, "now">) => (deps.now ?? (() => new Date()))();

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

function toBaseUnits(value: string, decimals: number): bigint | null {
  const scaled = new Decimal(value).mul(new Decimal(10).pow(decimals));
  return scaled.isInteger() ? BigInt(scaled.toFixed(0)) : null;
}

function fromBaseUnitsString(value: bigint, decimals: number): string {
  return new Decimal(value.toString()).div(new Decimal(10).pow(decimals)).toFixed();
}

function typedDataFor(transfer: Pick<TransferWithLines, "fromAddress" | "expiresAt">, line: TransferWithLines["lines"][number], token: TokenInfo) {
  return {
    domain: { name: token.domain.name, version: token.domain.version, chainId: MONAD_CHAIN_ID, verifyingContract: token.address },
    types: TRANSFER_WITH_AUTHORIZATION_TYPES as unknown as Record<string, { name: string; type: string }[]>,
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: transfer.fromAddress,
      to: line.toAddress,
      value: (toBaseUnits(line.amount.toString(), token.decimals) ?? 0n).toString(),
      validAfter: "0",
      validBefore: Math.floor(transfer.expiresAt.getTime() / 1000).toString(),
      nonce: line.nonce,
    },
  };
}

export function toTransfer(t: TransferWithLines, withAuthorizations = false): Wire {
  const token = tokenFor(t.asset);
  return {
    id: t.id,
    kind: t.kind,
    status: t.status,
    asset: t.asset,
    from: t.fromAddress,
    total_amount: amount(t.totalAmount),
    payment_id: t.paymentId,
    note: t.note,
    tx_hash: t.txHash,
    failure_reason: t.failureReason,
    lines: [...t.lines]
      .sort((a, b) => a.index - b.index)
      .map((l) => ({
        to: l.toAddress,
        amount: amount(l.amount),
        dest:
          l.destChain && l.destAddress && l.destStatus
            ? {
                chain: l.destChain,
                chain_name: chainById(l.destChain)?.name ?? l.destChain,
                address: l.destAddress,
                asset: l.destAsset ?? "",
                expected_out: l.destExpectedOut,
                status: l.destStatus,
                delivered_at: l.destDeliveredAt?.toISOString() ?? null,
              }
            : null,
      })),
    created_at: t.createdAt.toISOString(),
    expires_at: t.expiresAt.toISOString(),
    submitted_at: t.submittedAt?.toISOString() ?? null,
    confirmed_at: t.confirmedAt?.toISOString() ?? null,
    ...(withAuthorizations && token && t.status === "AWAITING_SIGNATURE"
      ? { authorizations: [...t.lines].sort((a, b) => a.index - b.index).map((l) => ({ index: l.index, typed_data: typedDataFor(t, l, token) })) }
      : {}),
  };
}

function requireChain(deps: TransferDeps): TransferChain {
  if (!deps.chain || !deps.chain.relayerAddress()) {
    throw new ApiError(503, "transfers_unavailable", "Sending from Tender is not switched on right now. Try again later.");
  }
  return deps.chain;
}

/** The merchant's wallet and the token it sends in, or a clear reason they cannot send. */
function senderOf(merchant: Merchant): { from: Hex; token: TokenInfo } {
  if (!merchant.settlementAddress || !merchant.settlementVerified) {
    throw conflict("Verify your wallet in Settings before sending money from it.");
  }
  const token = tokenFor(merchant.settlementAsset);
  if (!token) {
    throw new ApiError(
      409,
      "asset_unsupported",
      `You settle in ${merchant.settlementAsset ?? "an asset"} that Tender cannot send for you. Switch to USDC or USDT0 in Settings, or send it from your own wallet.`,
    );
  }
  return { from: getAddress(merchant.settlementAddress), token };
}

async function ensureRelayerFunded(deps: TransferDeps, chain: TransferChain) {
  if ((await chain.relayerBalance()) < deps.config.minRelayerWei) {
    throw new ApiError(503, "transfers_unavailable", "Sending from Tender is paused while we top up our network fees. Try again shortly.");
  }
}

/* -------------------------------------------------------------------------- */
/* Wallet balance                                                              */
/* -------------------------------------------------------------------------- */

export async function walletInfo(deps: TransferDeps, merchant: Merchant): Promise<z.output<typeof S.WalletBalance>> {
  const base = { address: merchant.settlementAddress ?? null, asset: merchant.settlementAsset ?? null };
  if (!deps.chain || !deps.chain.relayerAddress()) return { ...base, balance: null, can_send: false, reason: "Sending from Tender is not switched on yet." };
  let sender;
  try {
    sender = senderOf(merchant);
  } catch (err) {
    return { ...base, balance: null, can_send: false, reason: (err as ApiError).message };
  }
  try {
    const raw = await deps.chain.tokenBalance(sender.token.address, sender.from);
    const balance = fromBaseUnitsString(raw, sender.token.decimals);
    const funded = (await deps.chain.relayerBalance()) >= deps.config.minRelayerWei;
    return { ...base, balance: amount(new Decimal(balance)), can_send: funded, reason: funded ? null : "Sending is paused while we top up our network fees." };
  } catch {
    return { ...base, balance: null, can_send: false, reason: "We could not read your wallet balance just now. Try again." };
  }
}

/* -------------------------------------------------------------------------- */
/* Sending to another chain: what is possible, and what it would deliver       */
/* -------------------------------------------------------------------------- */

function requireAurora(deps: TransferDeps) {
  const a = deps.aurora;
  if (!a?.tokens || !a.routeQuote || !a.mintAddress) {
    throw new ApiError(503, "transfers_unavailable", "Sending to another chain is not switched on right now. Try again later.");
  }
  return { tokens: a.tokens.bind(a), routeQuote: a.routeQuote.bind(a), mintAddress: a.mintAddress.bind(a) };
}

/** Every chain a payout or refund can reach. */
export async function listPayoutChains(deps: TransferDeps) {
  return payoutChains(requireAurora(deps));
}

/** A dry run: would Aurora take this, and roughly what would the recipient get? Moves and creates nothing. */
export async function quoteTransfer(deps: TransferDeps, merchant: Merchant, input: { dest_chain: string; to: string; amount: string }): Promise<z.output<typeof S.QuoteTransferResult>> {
  const aurora = requireAurora(deps);
  const { from, token } = senderOf(merchant);
  if (!isAmount(input.amount) || new Decimal(input.amount).lte(0)) return { ok: false, field: "amount", message: "Enter an amount above zero." };
  const route = await checkRoute(aurora, { chainId: input.dest_chain, to: input.to, amount: input.amount, from, token });
  if (!route.ok) return { ok: false, field: route.field, message: route.message };
  return { ok: true, asset: route.destination.symbol, receive: route.expectedOut, seconds: route.seconds };
}

/* -------------------------------------------------------------------------- */
/* Prepare                                                                     */
/* -------------------------------------------------------------------------- */

export async function prepareTransfer(deps: TransferDeps, merchant: Merchant, input: PrepareInput): Promise<TransferWithLines> {
  const chain = requireChain(deps);
  const { from, token } = senderOf(merchant);
  const now = clock(deps);

  // ── Shape of the request ────────────────────────────────────────────────
  const { kind, lines } = input;
  if (kind === "PAYOUT" && lines.length !== 1) throw validation({ lines: "A payout has exactly one recipient. Use a split for several." });
  if (kind === "REFUND" && lines.length !== 1) throw validation({ lines: "A refund goes to one address." });
  if (kind === "REFUND" && !input.payment_id) throw validation({ payment_id: "Say which payment this refunds." });
  if (kind !== "REFUND" && input.payment_id) throw validation({ payment_id: "Only a refund points at a payment." });
  if (kind === "SPLIT" && lines.length < 2) throw validation({ lines: "A split needs at least two recipients." });
  if (lines.length > deps.config.maxLines) throw validation({ lines: `At most ${deps.config.maxLines} recipients in one transfer.` });

  let total = new Decimal(0);
  const checked = lines.map((line, i) => {
    // A line can go to another chain. Its Monad leg is still part of the one transaction, so a split
    // still lands whole or not at all on Monad; only Aurora's delivery afterwards is per recipient.
    const cross = !!line.dest_chain && line.dest_chain !== SETTLEMENT_CHAIN;
    const fields: Record<string, string> = {};
    // For another chain the address is the destination chain's, so Aurora judges it (below), not these EVM checks.
    if (!cross && !isAddress(line.to, { strict: true })) fields[`lines.${i}.to`] = "Not a valid address (a mixed-case address must have the right checksum).";
    const to = !cross && isAddress(line.to) ? getAddress(line.to) : null;
    if (to === zeroAddress) fields[`lines.${i}.to`] = "That is the burn address. Money sent there is gone for good.";
    if (to && to.toLowerCase() === token.address.toLowerCase()) fields[`lines.${i}.to`] = `That is the ${token.symbol} contract itself. Money sent there is lost.`;
    if (to && to.toLowerCase() === MULTICALL3.toLowerCase()) fields[`lines.${i}.to`] = "That is a system contract, not a person's wallet.";
    if (to && to.toLowerCase() === from.toLowerCase()) fields[`lines.${i}.to`] = "That is your own wallet.";
    if (cross && !line.to) fields[`lines.${i}.to`] = "Enter the recipient's address.";

    let units: bigint | null = null;
    if (!isAmount(line.amount) || new Decimal(line.amount).lte(0)) fields[`lines.${i}.amount`] = "Enter an amount above zero.";
    else {
      units = toBaseUnits(line.amount, token.decimals);
      if (units === null) fields[`lines.${i}.amount`] = `${token.symbol} has ${token.decimals} decimal places at most.`;
    }
    if (Object.keys(fields).length) throw validation(fields);
    total = total.add(line.amount);
    return { to: cross ? line.to : to!, amount: line.amount, destChain: cross ? line.dest_chain! : null };
  });

  // ── The wallet must be able to cover it ─────────────────────────────────
  await ensureRelayerFunded(deps, chain);
  const balance = await chain.tokenBalance(token.address, from).catch(() => null);
  if (balance === null) throw new ApiError(503, "chain_unavailable", "We could not read your wallet balance just now. Try again.");
  const need = toBaseUnits(total.toFixed(), token.decimals)!;
  if (balance < need) {
    throw new ApiError(409, "insufficient_balance", `Your wallet holds ${fromBaseUnitsString(balance, token.decimals)} ${token.symbol}, and this sends ${total.toFixed()}.`);
  }

  // ── Fair use: each relayed transfer costs Tender network fees ───────────
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const sent = await deps.db.transfer.count({ where: { merchantId: merchant.id, createdAt: { gte: since }, status: { in: ["SUBMITTED", "CONFIRMED"] } } });
  if (sent >= deps.config.dailyLimit) {
    throw new ApiError(429, "daily_limit", `You have reached today's limit of ${deps.config.dailyLimit} transfers. It resets within 24 hours.`);
  }

  // ── Another chain: have Aurora vet each such line and mint the Monad address that delivers it ──
  // The wallet signs a plain Monad transfer to that one-off address; the recipient's real address
  // is kept in `destAddress` and is what the signing prompt shows. Every line is vetted BEFORE any
  // address is minted, so a split with one bad line is refused up front and nothing is created.
  type Dest = { chain: string; address: string; asset: string; expectedOut: string | null };
  const dests = new Map<number, Dest>();
  if (checked.some((l) => l.destChain)) {
    const aur = requireAurora(deps);
    // Minting creates an address at Aurora, so a refund over its cap is refused first.
    if (kind === "REFUND") await assertRefundable(deps.db, merchant.id, input.payment_id!, total, token.symbol, now);
    const routes = new Map<number, Extract<Awaited<ReturnType<typeof checkRoute>>, { ok: true }>>();
    for (const [i, l] of checked.entries()) {
      if (!l.destChain) continue;
      const route = await checkRoute(aur, { chainId: l.destChain, to: l.to, amount: l.amount, from, token });
      if (!route.ok) routeFailure(route, i);
      routes.set(i, route);
    }
    for (const [i, route] of routes) {
      const l = checked[i]!;
      dests.set(i, { chain: route.chain.id, address: l.to, asset: route.destination.symbol, expectedOut: route.expectedOut });
      l.to = getAddress(await mintRoute(aur, route, l.to));
    }
  }

  const expiresAt = new Date(now.getTime() + AUTHORIZATION_TTL_MS);
  const create = (tx: Prisma.TransactionClient) =>
    tx.transfer.create({
      data: {
        merchantId: merchant.id,
        kind,
        asset: token.symbol,
        fromAddress: from,
        totalAmount: total.toFixed(),
        paymentId: input.payment_id ?? null,
        note: input.note || null,
        expiresAt,
        lines: {
          create: checked.map((l, index) => {
            const d = dests.get(index);
            return {
              index,
              toAddress: l.to,
              amount: l.amount,
              nonce: `0x${randomBytes(32).toString("hex")}`,
              ...(d ? { destChain: d.chain, destAddress: d.address, destAsset: d.asset, destExpectedOut: d.expectedOut, destStatus: "PENDING" as const } : {}),
            };
          }),
        },
      },
      include: { lines: true },
    });

  if (kind !== "REFUND") return create(deps.db);

  // ── A refund is capped by what the payment actually delivered ───────────
  // Under a row lock, so two refunds started at once cannot both pass the check.
  return deps.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.payment_id!} FOR UPDATE`;
    await assertRefundable(tx, merchant.id, input.payment_id!, total, token.symbol, now);
    return create(tx);
  });
}

/**
 * A refund may return at most what the payment delivered, minus refunds already made or in flight.
 * Run once before anything is minted (so a refused refund creates nothing at Aurora), and again
 * under the payment's row lock (so two refunds started at once cannot both pass).
 */
async function assertRefundable(tx: Prisma.TransactionClient | Db, merchantId: string, paymentId: string, total: Decimal, symbol: string, now: Date) {
  const payment = await tx.payment.findFirst({ where: { id: paymentId, invoice: { merchantId } } });
  if (!payment) throw notFound("Payment");
  if (payment.status !== "SETTLED" || !payment.amountSettled) throw conflict("Only a payment that has settled can be refunded.");

  const open = await tx.transfer.aggregate({
    where: {
      paymentId: payment.id,
      OR: [{ status: { in: ["SUBMITTED", "CONFIRMED"] } }, { status: "AWAITING_SIGNATURE", expiresAt: { gt: now } }],
    },
    _sum: { totalAmount: true },
  });
  const refundable = new Decimal(payment.amountSettled.toString()).sub(new Decimal(open._sum.totalAmount?.toString() ?? "0"));
  if (total.gt(refundable)) {
    throw new ApiError(
      409,
      "over_refund",
      refundable.lte(0)
        ? "This payment has already been refunded in full."
        : `You can refund at most ${amount(refundable)} ${symbol} of this payment (the rest is already refunded or being refunded).`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Submit                                                                      */
/* -------------------------------------------------------------------------- */

export async function submitTransfer(deps: TransferDeps, merchant: Merchant, id: string, signatures: string[]): Promise<TransferWithLines> {
  const chain = requireChain(deps);
  const now = clock(deps);
  const transfer = await deps.db.transfer.findFirst({ where: { id, merchantId: merchant.id }, include: { lines: true } });
  if (!transfer) throw notFound("Transfer");
  if (transfer.status !== "AWAITING_SIGNATURE") throw conflict(`This transfer is already ${transfer.status.toLowerCase().replace("_", " ")}.`);
  if (transfer.expiresAt <= now) {
    await deps.db.transfer.updateMany({ where: { id, status: "AWAITING_SIGNATURE" }, data: { status: "EXPIRED", failureReason: "The signing window ran out before it was sent." } });
    throw new ApiError(410, "expired", "The signing window ran out. Nothing was sent; start again.");
  }
  const token = tokenFor(transfer.asset);
  if (!token) throw new ApiError(500, "internal", "Unknown token on a stored transfer");
  const lines = [...transfer.lines].sort((a, b) => a.index - b.index);
  if (signatures.length !== lines.length) throw validation({ signatures: `Expected ${lines.length} signature(s), got ${signatures.length}.` });

  // ── Every signature must come from the merchant's own wallet ────────────
  // ⚠️ The wallet is read from the transfer (fixed when it was prepared), and
  // each signature is recovered against the exact typed data we issued. A
  // signature from any other key, or over any other recipient/amount, fails.
  const signed: SignedLine[] = [];
  for (const [i, line] of lines.entries()) {
    const typed = typedDataFor(transfer, line, token);
    let signer: string | null = null;
    try {
      signer = await recoverTypedDataAddress({
        domain: { ...typed.domain, verifyingContract: typed.domain.verifyingContract as Hex },
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: typed.message.from as Hex,
          to: typed.message.to as Hex,
          value: BigInt(typed.message.value),
          validAfter: BigInt(typed.message.validAfter),
          validBefore: BigInt(typed.message.validBefore),
          nonce: typed.message.nonce as Hex,
        },
        signature: signatures[i] as Hex,
      });
    } catch {
      signer = null;
    }
    if (!signer || signer.toLowerCase() !== transfer.fromAddress.toLowerCase()) {
      throw validation({ [`signatures.${i}`]: "That signature does not come from your wallet." });
    }
    signed.push({
      from: transfer.fromAddress as Hex,
      to: line.toAddress as Hex,
      value: BigInt(typed.message.value),
      validAfter: 0n,
      validBefore: BigInt(typed.message.validBefore),
      nonce: line.nonce as Hex,
      signature: signatures[i] as Hex,
    });
  }

  await ensureRelayerFunded(deps, chain);

  // ── Claim it: exactly one submit may proceed ────────────────────────────
  const claimed = await deps.db.transfer.updateMany({ where: { id, status: "AWAITING_SIGNATURE" }, data: { status: "SUBMITTED", submittedAt: now } });
  if (claimed.count !== 1) throw conflict("This transfer was just submitted.");
  await Promise.all(lines.map((line, i) => deps.db.transferLine.update({ where: { id: line.id }, data: { signature: signatures[i]! } })));

  let hash: Hex;
  try {
    hash = await chain.send(token.address, signed);
  } catch (err) {
    if (err instanceof TransferRejected) {
      // Rejected in simulation: nothing was broadcast, the nonces are unused, no money moved.
      await deps.db.transfer.update({ where: { id }, data: { status: "FAILED", failureReason: `The network refused it, so nothing was sent. ${err.message}` } });
      throw new ApiError(409, "rejected", "The network refused this transfer, so nothing was sent. Check your balance and try again.");
    }
    // Unknown: it may or may not have been broadcast. Left SUBMITTED with no hash;
    // reconciliation settles it from the nonces on-chain.
    throw new ApiError(502, "chain_unavailable", "We could not confirm this was sent. Check Activity in a minute before trying again.");
  }

  return deps.db.transfer.update({ where: { id }, data: { txHash: hash }, include: { lines: true } });
}

/* -------------------------------------------------------------------------- */
/* Read                                                                        */
/* -------------------------------------------------------------------------- */

export async function getTransfer(db: Db, merchantId: string, id: string): Promise<TransferWithLines> {
  const t = await db.transfer.findFirst({ where: { id, merchantId }, include: { lines: true } });
  if (!t) throw notFound("Transfer");
  return t;
}

export async function listTransfers(db: Db, merchantId: string, limit = 25): Promise<TransferWithLines[]> {
  return db.transfer.findMany({ where: { merchantId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: Math.min(Math.max(limit, 1), 100), include: { lines: true } });
}

/** Total already refunded for each of these payments (submitted or confirmed), by payment id. */
export async function refundedByPayment(db: Db, paymentIds: string[]): Promise<Map<string, string>> {
  if (paymentIds.length === 0) return new Map();
  const rows = await db.transfer.groupBy({
    by: ["paymentId"],
    where: { paymentId: { in: paymentIds }, status: { in: ["SUBMITTED", "CONFIRMED"] } },
    _sum: { totalAmount: true },
  });
  return new Map(rows.filter((r) => r.paymentId).map((r) => [r.paymentId!, amount(r._sum.totalAmount ?? 0)]));
}

/* -------------------------------------------------------------------------- */
/* Reconcile: what the chain says is the only truth                            */
/* -------------------------------------------------------------------------- */

/**
 * Settles every in-flight transfer from the chain, and expires unsigned ones.
 * Called by the worker. Idempotent: running it twice changes nothing the second time.
 */
export async function reconcileTransfers(deps: TransferDeps): Promise<{ confirmed: number; failed: number; expired: number }> {
  const out = { confirmed: 0, failed: 0, expired: 0 };
  const now = clock(deps);

  const expired = await deps.db.transfer.updateMany({
    where: { status: "AWAITING_SIGNATURE", expiresAt: { lte: now } },
    data: { status: "EXPIRED", failureReason: "The signing window ran out before it was sent." },
  });
  out.expired = expired.count;

  const chain = deps.chain;
  if (!chain) return out;

  const inFlight = await deps.db.transfer.findMany({ where: { status: "SUBMITTED" }, include: { lines: true }, take: 50, orderBy: { submittedAt: "asc" } });
  for (const t of inFlight) {
    const token = tokenFor(t.asset);
    if (!token) continue;

    const used = await Promise.all(t.lines.map((l) => chain.authorizationUsed(token.address, t.fromAddress as Hex, l.nonce as Hex).catch(() => null)));
    if (used.some((u) => u === null)) continue; // RPC trouble: look again next tick

    const receipt = t.txHash ? await chain.receipt(t.txHash as Hex) : null;
    const allUsed = used.every((u) => u === true);
    const noneUsed = used.every((u) => u === false);
    const decide = async (status: "CONFIRMED" | "FAILED", failureReason: string | null) => {
      const res = await deps.db.transfer.updateMany({
        where: { id: t.id, status: "SUBMITTED" },
        data: { status, failureReason, ...(status === "CONFIRMED" ? { confirmedAt: now } : {}) },
      });
      if (res.count === 1) out[status === "CONFIRMED" ? "confirmed" : "failed"] += 1;
    };

    if (receipt?.status === "success" && allUsed) {
      await decide("CONFIRMED", null);
    } else if (receipt?.status === "success") {
      await decide("FAILED", "The network accepted the transaction but did not execute every transfer. Check your wallet before trying again.");
    } else if (receipt?.status === "reverted") {
      if (allUsed) await decide("CONFIRMED", null); // someone else submitted the same signatures: the money still moved as signed
      else if (noneUsed) await decide("FAILED", "The transaction failed on the network, so no money moved.");
      else await decide("FAILED", "Some transfers went through separately and others did not. Check your wallet before trying again.");
    } else if (allUsed) {
      // No receipt known, but every authorization is spent: the money moved as signed.
      await decide("CONFIRMED", null);
    } else if (noneUsed && now.getTime() > t.expiresAt.getTime() + STUCK_AFTER_MS) {
      // Never mined, and the signatures have now expired: they can never execute.
      await decide("FAILED", "The transaction was never confirmed and the signatures have expired, so no money moved.");
    }
  }
  await reconcileDeliveries(deps, now);
  return out;
}

const DELIVERY_CHECK_MS = 30_000;
let lastDeliveryCheck = 0;

/**
 * The second leg of a cross-chain transfer: once the Monad transfer is CONFIRMED, Aurora should
 * deliver to the recipient. Its per-address deposit list is the only record of that, so the answer
 * comes from there and nowhere else. A transfer that never confirmed has nothing to deliver.
 */
async function reconcileDeliveries(deps: TransferDeps, now: Date) {
  const aurora = deps.aurora;
  if (!aurora?.deposits) return;
  // The transfer loop ticks every 5s, but it shares Aurora's rate limit with the invoice poller, and a
  // delivery takes a minute or two anyway. Asking every 30s keeps this from crowding out detection.
  if (now.getTime() - lastDeliveryCheck < DELIVERY_CHECK_MS) return;
  lastDeliveryCheck = now.getTime();

  // A transfer that never confirmed moved nothing, so there is nothing to deliver.
  await deps.db.transferLine.updateMany({ where: { destStatus: "PENDING", transfer: { status: { in: ["FAILED", "EXPIRED"] } } }, data: { destStatus: "FAILED" } });

  const waiting = await deps.db.transferLine.findMany({
    // A day is far beyond Aurora's delivery time; past it, stop asking and leave it for support.
    where: { destStatus: "PENDING", transfer: { status: "CONFIRMED", confirmedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } } },
    take: 20,
    orderBy: { transfer: { confirmedAt: "asc" } },
  });
  for (const line of waiting) {
    try {
      // Each line has its own deposit address, so its own record at Aurora.
      if ((await aurora.deposits(line.toAddress, "success")).length > 0) {
        await deps.db.transferLine.updateMany({ where: { id: line.id, destStatus: "PENDING" }, data: { destStatus: "DELIVERED", destDeliveredAt: now } });
      } else if ((await aurora.deposits(line.toAddress, "failed")).length > 0) {
        await deps.db.transferLine.updateMany({ where: { id: line.id, destStatus: "PENDING" }, data: { destStatus: "FAILED" } });
      }
    } catch {
      // Aurora trouble: look again next tick.
    }
  }
}
