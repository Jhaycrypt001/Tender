import type { Redis } from "ioredis";
import type { Db } from "../db/client.js";
import { Prisma } from "../generated/prisma/client.js";
import { conflict, notFound } from "../lib/errors.js";
import { notifyDepositOutcomes, publishTransitions, settleInvoice, type JudgeContext } from "./invoice-judge.js";

/**
 * Closes a payment that Aurora resolved outside its deposit lists: support refunded the sender by hand, or
 * delivered to the merchant directly. Neither ever appears in Aurora's `success` or `failed` list, so without this
 * the payment would stay "Seen on chain" forever and the stuck-deposit warning would never stop.
 *
 * Operator-only (platform key), never part of the public contract. It requires proof (a transaction hash) and a
 * reason, and applies the same rules as the poller: the invoice is re-judged, and the merchant gets the same
 * webhook the poller would have sent.
 */

export type ResolveInput = {
  outcome: "refunded" | "settled";
  /** The transaction that proves it: the refund to the sender, or the delivery to the merchant. */
  tx_hash: string;
  /** What was delivered to the merchant, in the settlement asset. Required for "settled". */
  amount_settled?: string;
  /** Why, in a sentence. Kept on the payment for audit. */
  note: string;
};

export type ResolveDeps = {
  db: Db;
  redis: Pick<Redis, "publish">;
  logger: JudgeContext["logger"];
  graceMinutes: number;
  toleranceBps: number;
  now?: () => Date;
};

const OPEN_RECOVERY = ["OPEN", "RETRYING"];

export async function resolvePaymentManually(deps: ResolveDeps, paymentId: string, input: ResolveInput) {
  const now = deps.now?.() ?? new Date();
  const status = input.outcome === "settled" ? ("SETTLED" as const) : ("REFUNDED" as const);

  const { payment, transitions } = await deps.db.$transaction(async (tx) => {
    const found = await tx.payment.findUnique({ where: { id: paymentId }, select: { invoiceId: true } });
    if (!found) throw notFound("Payment");
    // The same lock the poller takes, so a payout it finds at the same moment cannot race this.
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${found.invoiceId} FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { recovery: true, invoice: { select: { kind: true } } } });

    const recoveryOpen = !!p.recovery && OPEN_RECOVERY.includes(p.recovery.state);
    const waiting = (p.status === "DETECTED" && !p.outcomeTxHash) || (p.status === "FAILED" && recoveryOpen);
    if (!waiting) throw conflict(`This payment is already ${p.status.toLowerCase()}. Only a payment still waiting on Aurora can be resolved by hand.`);

    const manual = { outcome: input.outcome, tx_hash: input.tx_hash, note: input.note, amount_settled: input.amount_settled ?? null, at: now.toISOString() };
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status,
        // Prefixed, so it can never collide with a real Aurora payout hash recorded later.
        outcomeTxHash: `manual:${input.tx_hash}`,
        amountSettled: status === "SETTLED" ? input.amount_settled! : null,
        settledAt: status === "SETTLED" ? now : null,
        raw: { ...(p.raw as Record<string, unknown> | null), manual } as Prisma.InputJsonValue,
      },
    });
    if (p.recovery && recoveryOpen) {
      await tx.recoveryTask.update({
        where: { paymentId },
        data: {
          state: "RESOLVED",
          notes: [p.recovery.notes, `[${now.toISOString()}] Resolved by hand: ${input.outcome} (${input.tx_hash}). ${input.note}`].filter(Boolean).join("\n"),
        },
      });
    }

    const ctx: JudgeContext = { now, graceMinutes: deps.graceMinutes, toleranceBps: deps.toleranceBps, logger: deps.logger };
    // A standing address is not a bill: nothing is judged. A settled deposit gets its webhook, as from the poller.
    // There is no published webhook for a refund, so a refunded one gets none.
    if (p.invoice.kind === "STANDING") {
      if (status === "SETTLED") await notifyDepositOutcomes(tx, p.invoiceId, [{ paymentId, status: "SETTLED" }], ctx);
      return { payment: updated, transitions: [] };
    }
    // mayClose stays false, as for any single poll: only the poller's expiry pass, which has seen every address
    // polled after the window, may close an invoice.
    return { payment: updated, transitions: await settleInvoice(tx, p.invoiceId, { mayClose: false }, ctx) };
  });

  await publishTransitions(deps.redis, deps.logger, transitions);
  deps.logger.info(
    { paymentId, invoiceId: payment.invoiceId, outcome: status, proofTx: input.tx_hash, amountSettled: input.amount_settled ?? null, note: input.note, invoiceTransitions: transitions.length },
    "payment resolved manually",
  );
  return payment;
}
