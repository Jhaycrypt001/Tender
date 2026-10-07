import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import type { Merchant, Prisma } from "../generated/prisma/client.js";
import { ApiError, conflict, notFound, validation } from "../lib/errors.js";
import { amount, toPayment } from "./serialize.js";

/**
 * Payments and the NEEDS_RECOVERY actions (BACKEND.md §7).
 *
 * ⚠️ What Aurora actually offers, verified 2026-09-26: persistent deposit
 * addresses have NO retry, withdraw or refund API. The "recovery is explicit"
 * model in the spec comes from Intents Connect executions, a different
 * product. For a failed payout, Aurora's documented route is a support case
 * (https://aurora.dev/intents-support) carrying the tx hash and deposit
 * address. So these actions do exactly what is real, and say so:
 *
 *   retry     re-checks Aurora for the payout now, and keeps checking. If
 *             Aurora completes it, the payment settles and the task resolves.
 *   withdraw  records where the merchant wants the funds and attaches a
 *             ready-to-file support case. The task is NOT marked withdrawn —
 *             nothing has moved until Aurora moves it.
 *   refund    not supported: there is no refund-to-sender API.
 */

const SUPPORT_URL = "https://aurora.dev/intents-support";

const detailInclude = {
  invoice: { select: { id: true, reference: true, amountExpected: true, currency: true, status: true, kind: true, merchantId: true } },
  address: { select: { address: true } },
  recovery: true,
} satisfies Prisma.PaymentInclude;

type PaymentWithDetail = Prisma.PaymentGetPayload<{ include: typeof detailInclude }>;

export async function listPayments(db: Db, merchantId: string, query: z.output<typeof S.ListPaymentsQuery>) {
  const limit = query.limit ?? 20;
  const rows = await db.payment.findMany({
    where: {
      invoice: { merchantId, ...(query.invoice_status ? { status: query.invoice_status } : {}) },
      ...(query.status ? { status: query.status } : {}),
    },
    include: { invoice: { select: { kind: true } } },
    orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { page, hasMore, nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null };
}

export async function getPayment(db: Db, merchantId: string, id: string): Promise<PaymentWithDetail> {
  const payment = await db.payment.findFirst({ where: { id, invoice: { merchantId } }, include: detailInclude });
  if (!payment) throw notFound("Payment");
  return payment;
}

export async function retryPayment(db: Db, merchantId: string, id: string) {
  const payment = await getPayment(db, merchantId, id);
  const task = requireOpenTask(payment);

  await db.$transaction([
    db.recoveryTask.update({
      where: { id: task.id },
      data: { state: "RETRYING", attempts: { increment: 1 }, notes: appendNote(task.notes, "Retry requested: re-checking Aurora for the payout.") },
    }),
    // Poll this address on the very next tick.
    db.invoiceAddress.update({ where: { id: payment.invoiceAddressId }, data: { nextPollAt: new Date(), pollFailures: 0 } }),
  ]);
  return getPayment(db, merchantId, id);
}

export async function withdrawPayment(db: Db, merchant: Merchant, id: string, address: string | undefined) {
  const payment = await getPayment(db, merchant.id, id);
  const task = requireOpenTask(payment);

  const destination = address ?? merchant.settlementAddress;
  if (!destination) throw validation({ address: "no address given and no settlement address on file" });
  if (!/^0x[0-9a-fA-F]{40}$/.test(destination)) throw validation({ address: "must be an EVM address" });

  const raw = payment.raw as { received?: { intents_account?: string } } | null;
  const supportCase = [
    `Withdrawal requested to ${destination}.`,
    `Aurora has no withdrawal API for persistent deposit addresses, so this needs a support case: ${SUPPORT_URL}`,
    `Include — transaction hash: ${payment.auroraTxHash}; deposit address: ${payment.address.address}` +
      (raw?.received?.intents_account ? `; intents account: ${raw.received.intents_account}` : "") +
      `; amount: ${amount(payment.amountIn)} (${payment.fromChain}); requested destination: ${destination}.`,
  ].join(" ");

  await db.recoveryTask.update({
    where: { id: task.id },
    // State stays OPEN: nothing has moved yet, and the dashboard must not say otherwise.
    data: { state: "OPEN", notes: appendNote(task.notes, supportCase) },
  });
  return getPayment(db, merchant.id, id);
}

export function refundPayment(): never {
  throw new ApiError(
    501,
    "not_supported",
    "This route cannot refund: Aurora's persistent deposit addresses have no refund-to-sender API. To return money, send it from the settlement wallet with POST /v1/transfers (kind REFUND, payment_id). Under-minimum deposits are still refunded automatically by the network.",
  );
}

function requireOpenTask(payment: PaymentWithDetail) {
  const task = payment.recovery;
  if (!task) throw conflict("This payment has no recovery task: only a payment that failed onward can be retried or withdrawn");
  if (task.state === "RESOLVED" || task.state === "WITHDRAWN") throw conflict(`This recovery task is already ${task.state.toLowerCase()}`);
  return task;
}

function appendNote(existing: string | null, note: string): string {
  const line = `[${new Date().toISOString()}] ${note}`;
  return existing ? `${existing}\n${line}` : line;
}

/* -------------------------------------------------------------------------- */

export function toRecovery(task: NonNullable<PaymentWithDetail["recovery"]>): z.output<typeof S.RecoveryTask> {
  return {
    id: task.id,
    payment_id: task.paymentId,
    reason: task.reason,
    state: task.state,
    notes: task.notes,
    created_at: task.createdAt.toISOString(),
  };
}

/** Payment detail with a history reconstructed from what the payment records. */
export function toPaymentDetail(p: PaymentWithDetail, refunded?: string): z.output<typeof S.PaymentDetail> {
  const history: { status: string; at: string; note?: string }[] = [
    { status: "DETECTED", at: p.firstSeenAt.toISOString(), note: `${amount(p.amountIn)} received on ${p.fromChain}` },
  ];
  if (p.status === "SETTLED" && p.settledAt) {
    history.push({
      status: "SETTLED",
      at: p.settledAt.toISOString(),
      ...(p.amountSettled ? { note: `${amount(p.amountSettled)} delivered to the settlement address` } : {}),
    });
  }
  if (p.recovery) {
    history.push({ status: "FAILED", at: p.recovery.createdAt.toISOString(), note: p.recovery.reason });
    if (p.recovery.state !== "OPEN") history.push({ status: p.recovery.state, at: p.recovery.updatedAt.toISOString() });
  }

  return {
    ...toPayment(p, refunded, p.invoice),
    invoice: {
      id: p.invoice.id,
      reference: p.invoice.reference,
      amount_expected: amount(p.invoice.amountExpected),
      currency: p.invoice.currency,
      status: p.invoice.status,
    },
    history,
    recovery: p.recovery ? toRecovery(p.recovery) : null,
  };
}
