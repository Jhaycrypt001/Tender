import type { Redis } from "ioredis";
import type { InvoiceStatus, Prisma } from "../generated/prisma/client.js";
import { eventId } from "../lib/ids.js";
import { invoiceTransitions } from "../lib/metrics.js";
import { DEPOSIT_EVENTS, depositWebhookPayload, publishInvoiceEvent, webhookEventFor, webhookPayload, type InvoiceEventWire } from "./events.js";
import { amount } from "./serialize.js";
import { judge } from "./settlement.js";

/**
 * Judging an invoice from its payments, and telling the merchant. Shared by the poller (which finds payouts at
 * Aurora) and the operator's manual resolve (for a payout Aurora completed outside its lists), so both apply
 * exactly the same rules, history events and webhooks.
 */

type Tx = Prisma.TransactionClient;
type LogFn = (obj: object, msg?: string) => void;

export type Transition = { token: string; event: InvoiceEventWire };
export type ResolvedOutcome = { paymentId: string; status: "SETTLED" | "FAILED" };
export type JudgeContext = { now: Date; graceMinutes: number; toleranceBps: number; logger: { info: LogFn; warn: LogFn } };

/**
 * Re-judges an invoice from all of its payments and, if its status changes,
 * writes the change, its history event and its webhook — in the caller's
 * transaction. Must be called with the invoice row locked.
 *
 * `mayClose` gates EXPIRED and UNDERPAID: only a caller that has confirmed
 * every address was polled after the window closed may pass true.
 */
export async function settleInvoice(tx: Tx, invoiceId: string, opts: { mayClose: boolean }, ctx: JudgeContext): Promise<Transition[]> {
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { payments: { orderBy: { firstSeenAt: "asc" } }, merchant: { select: { webhookUrl: true } } },
  });
  const now = ctx.now;
  const closesAt = new Date(invoice.expiresAt.getTime() + ctx.graceMinutes * 60_000);

  // Money that reached Aurora after the window closed is recorded, but does
  // not move an open invoice. After SETTLED, any extra payment counts: it is
  // the published overpayment case.
  // A refunded payment went back to the buyer: it neither pays the invoice nor counts as an extra payment.
  const live = invoice.payments.filter((p) => p.status !== "REFUNDED");
  const counted = invoice.status === "SETTLED" ? live : live.filter((p) => p.firstSeenAt <= closesAt);

  const next = judge({
    status: invoice.status,
    amountExpected: invoice.amountExpected.toString(),
    payments: counted.map((p) => ({ status: p.status, amountInUsd: p.amountInUsd?.toString() ?? null })),
    closed: opts.mayClose && now > closesAt,
    toleranceBps: ctx.toleranceBps,
  });
  if (next === invoice.status) return [];

  const relevant = pickPayment(counted, next);
  await tx.invoice.update({ where: { id: invoice.id }, data: { status: next } });
  await tx.invoiceEvent.create({
    data: { id: eventId(), invoiceId: invoice.id, status: next, paymentId: relevant?.id ?? null, at: now },
  });

  const event = webhookEventFor(next);
  if (event && invoice.merchant.webhookUrl) {
    await tx.webhookDelivery.create({
      data: {
        merchantId: invoice.merchantId,
        invoiceId: invoice.id,
        event,
        payload: webhookPayload(event, invoice, next, relevant ?? null, now) as Prisma.InputJsonValue,
        nextRetryAt: now,
      },
    });
  }

  invoiceTransitions.inc({ to: next });
  ctx.logger.info({ invoiceId: invoice.id, from: invoice.status, to: next }, "invoice transition");
  return [
    {
      token: invoice.token,
      event: {
        status: next,
        at: now.toISOString(),
        ...(relevant
          ? { payment: { tx_hash: relevant.auroraTxHash, from_chain: relevant.fromChain, amount_in: amount(relevant.amountIn) } }
          : {}),
      },
    },
  ];
}

/** Queues a webhook for each deposit on a standing address that has just settled or failed. */
export async function notifyDepositOutcomes(tx: Tx, invoiceId: string, resolved: ResolvedOutcome[], ctx: Pick<JudgeContext, "now">) {
  if (!resolved.length) return;
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: { id: true, merchantId: true, merchant: { select: { webhookUrl: true } } },
  });
  if (!invoice.merchant.webhookUrl) return;
  const now = ctx.now;
  for (const { paymentId, status } of resolved) {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const event = status === "SETTLED" ? DEPOSIT_EVENTS.SETTLED : DEPOSIT_EVENTS.FAILED;
    await tx.webhookDelivery.create({
      data: {
        merchantId: invoice.merchantId,
        invoiceId: invoice.id,
        event,
        payload: depositWebhookPayload(event, invoice, payment, now) as Prisma.InputJsonValue,
        nextRetryAt: now,
      },
    });
  }
}

/** Pushes each transition to the checkout's live stream. Best-effort: the database is the truth. */
export async function publishTransitions(redis: Pick<Redis, "publish">, logger: { warn: LogFn }, transitions: Transition[]) {
  for (const t of transitions) {
    await publishInvoiceEvent(redis as Redis, t.token, t.event).catch((err: unknown) => logger.warn({ err }, "failed to publish invoice event"));
  }
}

/** The payment a transition is about, for the webhook and the SSE event. */
export function pickPayment<P extends { status: string; firstSeenAt: Date }>(payments: P[], status: InvoiceStatus): P | undefined {
  if (status === "NEEDS_RECOVERY") return payments.find((p) => p.status === "FAILED");
  if (status === "SETTLED" || status === "OVERPAID") return payments.find((p) => p.status === "SETTLED") ?? payments[0];
  return payments.at(-1);
}
