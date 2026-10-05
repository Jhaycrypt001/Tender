import type { Redis } from "ioredis";
import { tenderChainName } from "../aurora/chains.js";
import { AuroraError, type AuroraClient } from "../aurora/client.js";
import type { PriceBook } from "../aurora/prices.js";
import type { Deposit } from "../aurora/types.js";
import type { Db } from "../db/client.js";
import { Prisma, type InvoiceStatus } from "../generated/prisma/client.js";
import { eventId } from "../lib/ids.js";
import type { Logger } from "../lib/logger.js";
import { depositsSeen, invoiceTransitions, pollerTicks } from "../lib/metrics.js";
import { Decimal, fromBaseUnits } from "../lib/money.js";
import { publishInvoiceEvent, webhookEventFor, webhookPayload, type InvoiceEventWire } from "../services/events.js";
import { amount } from "../services/serialize.js";
import { judge, matchOutcomes } from "../services/settlement.js";

/**
 * The heart of the system (BACKEND.md §6). Aurora has no webhooks, so this
 * loop asks it, address by address, what has arrived and what has settled.
 *
 * Properties, each covered by a test:
 * - Idempotent: running a tick twice over the same data changes nothing the
 *   second time. Payments dedupe on `auroraTxHash`, outcomes on `outcomeTxHash`.
 * - Concurrency-safe: each invoice is processed under a row lock
 *   (`SELECT … FOR UPDATE`), so two pollers serialise instead of racing.
 * - Crash-safe: all state is in Postgres; a transition, its event row and its
 *   webhook outbox row commit together or not at all.
 * - Isolated: an address that errors backs off on its own schedule and never
 *   blocks the others.
 */

export type PollerConfig = {
  /** How often an address of an OPEN invoice is polled. Also how often the loop wakes. */
  intervalMs: number;
  /**
   * How often an address of a CLOSED invoice is polled (settled, expired, or stuck in recovery).
   * These are watched only for late or extra money, so a minute is plenty, and each poll is
   * three Aurora calls: polling them as fast as open ones was most of our traffic.
   */
  closedIntervalMs: number;
  toleranceBps: number;
  /** After the deadline, how long in-flight deposits still count. */
  graceMinutes: number;
  /** After an invoice closes, how long its addresses are still watched for late or extra money. */
  lateWindowHours: number;
  concurrency: number;
  batchSize: number;
};

export type PollerDeps = {
  db: Db;
  aurora: Pick<AuroraClient, "deposits">;
  prices: Pick<PriceBook, "usd">;
  redis: Pick<Redis, "publish">;
  logger: Logger;
  config: PollerConfig;
  now?: () => Date;
};

type Transition = { token: string; event: InvoiceEventWire };
type Tx = Prisma.TransactionClient;

const MAX_BACKOFF_MS = 5 * 60_000;

export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;

  constructor(private readonly deps: PollerDeps) {}

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  start(): void {
    this.stopped = false;
    const loop = async () => {
      this.running = this.tick().catch((err) => this.deps.logger.error({ err }, "poller tick failed"));
      await this.running;
      if (!this.stopped) this.timer = setTimeout(loop, this.deps.config.intervalMs);
    };
    void loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** One full pass: poll every due address, then close overdue invoices. */
  async tick(): Promise<{ polled: number; transitions: number; expired: number }> {
    const started = Date.now();
    const endTimer = pollerTicks.startTimer();
    const { polled, transitions } = await this.pollDue();
    const expired = await this.expireDue();
    endTimer();
    this.deps.logger.info({ polled, transitions, expired, ms: Date.now() - started }, "poller tick");
    return { polled, transitions, expired };
  }

  /* ------------------------------------------------------------------------ */

  private async pollDue() {
    const now = this.now();
    const lateCutoff = new Date(now.getTime() - this.deps.config.lateWindowHours * 3_600_000);
    const due = await this.deps.db.invoiceAddress.findMany({
      where: {
        nextPollAt: { lte: now },
        invoice: {
          OR: [
            { status: { in: ["PENDING", "DETECTED"] } },
            // Closed invoices stay watched for a while: a second payment after
            // SETTLED is an overpayment, and late money must be recorded.
            { status: { in: ["SETTLED", "OVERPAID", "EXPIRED"] }, expiresAt: { gt: lateCutoff } },
            // A failed payout with an open recovery task stays watched: if
            // Aurora completes it later, the payment settles (see recordOutcomes).
            { status: "NEEDS_RECOVERY", payments: { some: { recovery: { state: { in: ["OPEN", "RETRYING"] } } } } },
          ],
        },
      },
      orderBy: { nextPollAt: "asc" },
      take: this.deps.config.batchSize,
      select: { id: true, address: true, invoiceId: true, pollFailures: true, invoice: { select: { status: true } } },
    });

    let transitions = 0;
    await mapLimit(due, this.deps.config.concurrency, async (addr) => {
      try {
        transitions += await this.pollAddress(addr);
      } catch (err) {
        // Anything unexpected (a database error, a bug) is contained to this
        // address; it is retried on the next tick.
        this.deps.logger.error({ err, addressId: addr.id }, "poll failed unexpectedly");
      }
    });
    return { polled: due.length, transitions };
  }

  private async pollAddress(addr: {
    id: string;
    address: string;
    invoiceId: string;
    pollFailures: number;
    invoice: { status: string };
  }): Promise<number> {
    const { db, aurora, logger } = this.deps;
    let lists: { received: Deposit[]; success: Deposit[]; failed: Deposit[] };
    try {
      const [received, success, failed] = await Promise.all([
        aurora.deposits(addr.address, "received"),
        aurora.deposits(addr.address, "success"),
        aurora.deposits(addr.address, "failed"),
      ]);
      lists = { received, success, failed };
    } catch (err) {
      if (!(err instanceof AuroraError)) throw err;
      const failures = addr.pollFailures + 1;
      const delay = Math.min(this.deps.config.intervalMs * 2 ** failures, MAX_BACKOFF_MS);
      await db.invoiceAddress.update({
        where: { id: addr.id },
        data: { pollFailures: failures, nextPollAt: new Date(this.now().getTime() + delay) },
      });
      logger.warn({ addressId: addr.id, kind: err.kind, failures, retryInMs: delay }, "poll failed; backing off");
      return 0;
    }

    const deposits = await this.valueDeposits(lists.received);

    const transitions = await db.$transaction(async (tx) => {
      await lockInvoice(tx, addr.invoiceId);

      if (deposits.length) {
        const created = await tx.payment.createMany({
          data: deposits.map((d) => ({
            invoiceId: addr.invoiceId,
            invoiceAddressId: addr.id,
            auroraTxHash: d.raw.tx_hash,
            fromChain: tenderChainName(d.raw.fromChain),
            assetIn: d.raw.asset_id,
            amountIn: d.amountIn,
            amountInUsd: d.amountInUsd,
            status: "DETECTED" as const,
            // When the deposit reached Aurora: deterministic across re-polls,
            // and what the deadline is judged against.
            firstSeenAt: new Date(d.raw.created_at),
            raw: { received: d.raw } as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
        depositsSeen.inc(created.count);
      }

      await this.recordOutcomes(tx, addr, lists.success, "SETTLED");
      await this.recordOutcomes(tx, addr, lists.failed, "FAILED");

      await tx.invoiceAddress.update({
        where: { id: addr.id },
        data: { pollFailures: 0, nextPollAt: new Date(this.now().getTime() + this.pollEveryMs(addr.invoice.status)) },
      });

      // Polling one address never closes an invoice: its other addresses may
      // hold a payment not seen yet. Closing is expireDue's job alone.
      return this.settle(tx, addr.invoiceId, { mayClose: false });
    });

    await this.publish(transitions);
    return transitions.length;
  }

  /** Open invoices are watched closely; closed ones only for late money. */
  private pollEveryMs(invoiceStatus: string): number {
    const { intervalMs, closedIntervalMs } = this.deps.config;
    return invoiceStatus === "PENDING" || invoiceStatus === "DETECTED" ? intervalMs : closedIntervalMs;
  }

  /** Converts base units and prices each deposit. Entries we cannot read are skipped loudly, never guessed. */
  private async valueDeposits(received: Deposit[]) {
    const out: Array<{ raw: Deposit; amountIn: string; amountInUsd: string | null }> = [];
    for (const raw of received) {
      if (raw.decimals === null) {
        this.deps.logger.error({ tx: raw.tx_hash, asset: raw.asset_id }, "deposit has no decimals; cannot value it — skipped");
        continue;
      }
      const amountIn = fromBaseUnits(raw.amount, raw.decimals);
      const price = await this.deps.prices.usd(raw.asset_id).catch(() => null);
      if (price === null) this.deps.logger.warn({ tx: raw.tx_hash, asset: raw.asset_id }, "no USD price for deposit asset");
      out.push({ raw, amountIn, amountInUsd: price === null ? null : new Decimal(amountIn).mul(price).toFixed(18) });
    }
    return out;
  }

  /** Matches new payout outcomes to open deposits on this address and records them. */
  private async recordOutcomes(tx: Tx, addr: { id: string; invoiceId: string }, outcomes: Deposit[], status: "SETTLED" | "FAILED") {
    if (!outcomes.length) return;

    // Every outcome already recorded on this address. A payment keeps the
    // entries it was matched to in `raw`, so a failure that was later
    // superseded by a success is still recognised as seen.
    const onAddress = await tx.payment.findMany({
      where: { invoiceAddressId: addr.id },
      select: { id: true, auroraTxHash: true, firstSeenAt: true, raw: true, status: true, outcomeTxHash: true, recovery: true },
    });
    const seen = new Set<string>();
    for (const p of onAddress) {
      if (p.outcomeTxHash) seen.add(p.outcomeTxHash);
      const raw = p.raw as { success?: { tx_hash?: string }; failed?: { tx_hash?: string } } | null;
      if (raw?.success?.tx_hash) seen.add(raw.success.tx_hash);
      if (raw?.failed?.tx_hash) seen.add(raw.failed.tx_hash);
    }
    const fresh = outcomes.filter((o) => !seen.has(o.tx_hash));
    if (!fresh.length) return;

    const open = onAddress.filter((p) => p.status === "DETECTED" && !p.outcomeTxHash);
    const { pairs, orphans } = matchOutcomes(open, fresh);

    for (const { paymentId, outcome } of pairs) {
      await this.applyOutcome(tx, onAddress.find((p) => p.id === paymentId)!, outcome as Deposit, status);
      if (status === "FAILED") {
        await tx.recoveryTask.create({
          data: { paymentId, reason: "Deposit received, but the onward payout to the settlement address failed" },
        });
      }
    }

    // A payout that succeeds AFTER it failed: Aurora completed it on its own
    // or after a support case. The payment settles and its recovery resolves.
    // (The invoice stays NEEDS_RECOVERY — terminal states never move — and
    // the resolved task is what the dashboard shows.)
    let leftover = orphans;
    if (status === "SETTLED" && orphans.length) {
      const recovering = onAddress.filter(
        (p) => p.status === "FAILED" && p.recovery && (p.recovery.state === "OPEN" || p.recovery.state === "RETRYING"),
      );
      const recovered = matchOutcomes(recovering, orphans);
      for (const { paymentId, outcome } of recovered.pairs) {
        const payment = recovering.find((p) => p.id === paymentId)!;
        await this.applyOutcome(tx, payment, outcome as Deposit, "SETTLED");
        await tx.recoveryTask.update({
          where: { paymentId },
          data: {
            state: "RESOLVED",
            notes: [payment.recovery!.notes, `[${this.now().toISOString()}] Aurora completed the payout (${outcome.tx_hash}).`]
              .filter(Boolean)
              .join("\n"),
          },
        });
        this.deps.logger.info({ paymentId, payout: outcome.tx_hash }, "failed payout recovered");
      }
      leftover = recovered.orphans;
    }

    if (leftover.length) {
      this.deps.logger.warn(
        { addressId: addr.id, status, orphans: leftover.map((o) => o.tx_hash) },
        "payout outcome with no matching deposit — left for the next poll",
      );
    }
  }

  private async applyOutcome(tx: Tx, payment: { id: string; raw: unknown }, deposit: Deposit, status: "SETTLED" | "FAILED") {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status,
        outcomeTxHash: deposit.tx_hash,
        amountSettled: status === "SETTLED" && deposit.decimals !== null ? fromBaseUnits(deposit.amount, deposit.decimals) : null,
        settledAt: status === "SETTLED" ? new Date(deposit.created_at) : null,
        raw: { ...(payment.raw as Record<string, unknown> | null), [status === "SETTLED" ? "success" : "failed"]: deposit } as Prisma.InputJsonValue,
      },
    });
  }


  /**
   * Re-judges an invoice from all of its payments and, if its status changes,
   * writes the change, its history event and its webhook — in the caller's
   * transaction. Must be called with the invoice row locked.
   *
   * `mayClose` gates EXPIRED and UNDERPAID: only a caller that has confirmed
   * every address was polled after the window closed may pass true.
   */
  private async settle(tx: Tx, invoiceId: string, opts: { mayClose: boolean }): Promise<Transition[]> {
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { payments: { orderBy: { firstSeenAt: "asc" } }, merchant: { select: { webhookUrl: true } } },
    });
    const now = this.now();
    const closesAt = new Date(invoice.expiresAt.getTime() + this.deps.config.graceMinutes * 60_000);

    // Money that reached Aurora after the window closed is recorded, but does
    // not move an open invoice. After SETTLED, any extra payment counts: it is
    // the published overpayment case.
    const counted =
      invoice.status === "SETTLED" ? invoice.payments : invoice.payments.filter((p) => p.firstSeenAt <= closesAt);

    const next = judge({
      status: invoice.status,
      amountExpected: invoice.amountExpected.toString(),
      payments: counted.map((p) => ({ status: p.status, amountInUsd: p.amountInUsd?.toString() ?? null })),
      closed: opts.mayClose && now > closesAt,
      toleranceBps: this.deps.config.toleranceBps,
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
    this.deps.logger.info({ invoiceId: invoice.id, from: invoice.status, to: next }, "invoice transition");
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

  /**
   * Closes invoices whose window has passed: PENDING → EXPIRED, and a DETECTED
   * invoice whose payments all resolved short → UNDERPAID.
   *
   * Only once every address has been polled successfully after the window
   * closed — so an Aurora outage can never expire an invoice that was paid.
   */
  private async expireDue(): Promise<number> {
    const now = this.now();
    const graceMs = this.deps.config.graceMinutes * 60_000;
    const candidates = await this.deps.db.invoice.findMany({
      where: { status: { in: ["PENDING", "DETECTED"] }, expiresAt: { lt: new Date(now.getTime() - graceMs) } },
      select: { id: true, expiresAt: true, addresses: { select: { pollFailures: true, nextPollAt: true } } },
      take: this.deps.config.batchSize,
    });

    let changed = 0;
    for (const inv of candidates) {
      const closesAt = inv.expiresAt.getTime() + graceMs;
      const polledSinceClose = inv.addresses.every(
        (a) => a.pollFailures === 0 && a.nextPollAt.getTime() - this.deps.config.intervalMs >= closesAt,
      );
      if (!polledSinceClose) continue;

      const transitions = await this.deps.db.$transaction(async (tx) => {
        await lockInvoice(tx, inv.id);
        return this.settle(tx, inv.id, { mayClose: true });
      });
      await this.publish(transitions);
      changed += transitions.length;
    }
    return changed;
  }

  private async publish(transitions: Transition[]) {
    for (const t of transitions) {
      await publishInvoiceEvent(this.deps.redis as Redis, t.token, t.event).catch((err: unknown) =>
        // SSE is best-effort: the database is the truth, and a reconnecting
        // client re-reads the status.
        this.deps.logger.warn({ err }, "failed to publish invoice event"),
      );
    }
  }
}

async function lockInvoice(tx: Tx, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
}

/** The payment a transition is about, for the webhook and the SSE event. */
function pickPayment<P extends { status: string; firstSeenAt: Date }>(payments: P[], status: InvoiceStatus): P | undefined {
  if (status === "NEEDS_RECOVERY") return payments.find((p) => p.status === "FAILED");
  if (status === "SETTLED" || status === "OVERPAID") return payments.find((p) => p.status === "SETTLED") ?? payments[0];
  return payments.at(-1);
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
