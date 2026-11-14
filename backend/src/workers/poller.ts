import type { Redis } from "ioredis";
import { chainById, chainFromAssetId, tenderChainName } from "../aurora/chains.js";
import { AuroraError, type AuroraClient } from "../aurora/client.js";
import type { PriceBook } from "../aurora/prices.js";
import type { Deposit } from "../aurora/types.js";
import type { Db } from "../db/client.js";
import { Prisma, type InvoiceKind } from "../generated/prisma/client.js";
import type { Logger } from "../lib/logger.js";
import { depositsSeen, pollerTicks } from "../lib/metrics.js";
import { Decimal, fromBaseUnits } from "../lib/money.js";
import { judge, matchOutcomes, matchPayoutToDeposit } from "../services/settlement.js";
import { notifyDepositOutcomes, notifyLatePayments, publishTransitions, settleInvoice, type ResolvedOutcome, type Transition } from "../services/invoice-judge.js";

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

type Tx = Prisma.TransactionClient;

const MAX_BACKOFF_MS = 5 * 60_000;
/** A standing address is read in pages of this size, at most this many per poll. */
const STANDING_PAGE = 100;
const STANDING_MAX_PAGES = 20;
/** A deposit Aurora has held this long without a payout or a failure is reported. A normal payout takes about two minutes. */
const STUCK_AFTER_MS = 10 * 60_000;
const STUCK_SWEEP_EVERY_MS = 60_000;
const STUCK_REPORT_EVERY_MS = 15 * 60_000;
/** After a day a stuck deposit is a support case, not news: it is repeated daily so it is not forgotten, but does not drown new ones. */
const STUCK_LONG_AFTER_MS = 24 * 3_600_000;
const STUCK_LONG_REPORT_EVERY_MS = 24 * 3_600_000;
const STUCK_BATCH = 100;
/**
 * A deposit Aurora took but has not paid out keeps its address watched after the invoice's late window, so a
 * payout that lands days later is still recorded. Slowly, because each poll is up to three Aurora calls: every
 * 30 minutes for the first week, then every 6 hours, and not at all after 30 days (left to support by then).
 */
const STALL_WATCH_DAYS = 30;
const STALL_FAST_DAYS = 7;
const STALL_FAST_MS = 30 * 60_000;
const STALL_SLOW_MS = 6 * 3_600_000;
/** A quiet tick is logged at most this often, so the worker is visibly alive without a line every few seconds. */
const HEARTBEAT_MS = 15 * 60_000;
/** After a day of waiting, an address's payout lists are read every 30 minutes instead of every poll. */
const STALE_PAYOUT_AFTER_MS = 24 * 3_600_000;
const STALE_PAYOUT_CHECK_MS = 30 * 60_000;
/** Marks a payment recorded from a payout alone: its Aurora tx hash is not a deposit's. */
const PAYOUT_ONLY_PREFIX = "payout:";
/** How often a closed invoice with no payment on it is polled (see pollEveryMs). */
const CLOSED_UNPAID_MS = 5 * 60_000;
/** Invoices that have closed without being paid in full. Money that reaches one later is reported, not judged. */
const CLOSED_STATUSES: string[] = ["EXPIRED", "UNDERPAID", "CANCELLED"];
type OutcomeValue = { amount: string | null; usd: string | null };

/** How many pages of past-due invoices one expiry pass walks. */
const MAX_EXPIRE_PAGES = 10;

export class Poller {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;
  private stopped = false;
  /** When each stuck payment was last reported, so a long stall is one line per interval, not one per tick. */
  private readonly stuckReportedAt = new Map<string, number>();
  private lastStuckSweep = 0;
  private lastHeartbeat = 0;
  /** When each address's payout lists were last read, for the 30-minute cadence of a day-old wait. */
  private readonly payoutCheckedAt = new Map<string, number>();
  /** When a closed, unpaid invoice's payout lists were last read (see pollAddress). */
  private readonly unlistedCheckedAt = new Map<string, number>();

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
    await this.sweepStuck().catch((err) => this.deps.logger.error({ err }, "stuck-deposit sweep failed"));
    endTimer();
    // Only a tick that changed something is worth a line; otherwise one heartbeat every 15 minutes.
    const nowMs = this.now().getTime();
    if (transitions || expired || nowMs - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = nowMs;
      this.deps.logger.info({ polled, transitions, expired, ms: Date.now() - started }, "poller tick");
    } else {
      this.deps.logger.debug({ polled, transitions, expired, ms: Date.now() - started }, "poller tick");
    }
    return { polled, transitions, expired };
  }

  /* ------------------------------------------------------------------------ */

  private async pollDue() {
    const now = this.now();
    const lateCutoff = new Date(now.getTime() - this.deps.config.lateWindowHours * 3_600_000);
    const stallCutoff = new Date(now.getTime() - STALL_WATCH_DAYS * 86_400_000);
    const select = {
      id: true,
      address: true,
      invoiceId: true,
      pollFailures: true,
      invoice: { select: { status: true, kind: true, expiresAt: true, _count: { select: { payments: true } } } },
    } as const;
    // Open invoices are served first. One queue ordered by "most overdue" put a closed invoice that nobody is paying
    // ahead of a buyer who is paying right now whenever Aurora was slow and the batch was too small for everything.
    const open = await this.deps.db.invoiceAddress.findMany({
      where: { nextPollAt: { lte: now }, invoice: { status: { in: ["PENDING", "DETECTED"] } } },
      orderBy: { nextPollAt: "asc" },
      take: this.deps.config.batchSize,
      select,
    });
    const room = this.deps.config.batchSize - open.length;
    const closed = room <= 0 ? [] : await this.deps.db.invoiceAddress.findMany({
      where: {
        nextPollAt: { lte: now },
        invoice: {
          status: { notIn: ["PENDING", "DETECTED"] },
          OR: [
            // Closed invoices stay watched for a while: a second payment after
            // SETTLED is an overpayment, and late money must be recorded.
            // UNDERPAID and CANCELLED too: the "closed short" email invites a top-up, and a buyer can still pay a
            // link that was cancelled. Money sent there must be recorded, not left sitting unseen.
            { status: { in: ["SETTLED", "OVERPAID", "EXPIRED", "UNDERPAID", "CANCELLED"] }, expiresAt: { gt: lateCutoff } },
            // A failed payout with an open recovery task stays watched: if
            // Aurora completes it later, the payment settles (see recordOutcomes).
            { status: "NEEDS_RECOVERY", payments: { some: { recovery: { state: { in: ["OPEN", "RETRYING"] } } } } },
            // A deposit Aurora still holds (no payout, no failure yet) keeps its invoice watched past the late
            // window, so a payout that arrives days later is recorded and not lost. See STALL_WATCH_DAYS.
            { payments: { some: { status: "DETECTED", outcomeTxHash: null, firstSeenAt: { gt: stallCutoff } } } },
          ],
        },
      },
      orderBy: { nextPollAt: "asc" },
      take: room,
      select,
    });
    const due = [...open, ...closed];

    let transitions = 0;
    await mapLimit(due, this.deps.config.concurrency, async (addr) => {
      try {
        transitions += await this.pollAddress(addr);
      } catch (err) {
        // Anything unexpected (a database error, a bug) is contained to this address. It backs off exactly like an
        // Aurora failure: left alone it was retried every tick (every 10s), re-calling Aurora and logging an error each time.
        const failures = addr.pollFailures + 1;
        const delay = Math.min(this.deps.config.intervalMs * 2 ** failures, MAX_BACKOFF_MS);
        this.deps.logger.error({ err, addressId: addr.id, invoiceId: addr.invoiceId, address: addr.address, failures, retryInMs: delay }, "poll failed unexpectedly");
        await this.deps.db.invoiceAddress
          .update({ where: { id: addr.id }, data: { pollFailures: failures, nextPollAt: new Date(this.now().getTime() + delay) } })
          .catch(() => {});
      }
    });
    return { polled: due.length, transitions };
  }

  private async pollAddress(addr: {
    id: string;
    address: string;
    invoiceId: string;
    pollFailures: number;
    invoice: { status: string; kind: InvoiceKind; expiresAt: Date; _count?: { payments: number } };
  }): Promise<number> {
    const { db, aurora, logger } = this.deps;
    let lists: { received: Deposit[]; success: Deposit[]; failed: Deposit[] };
    try {
      const received =
        addr.invoice.kind === "STANDING" ? await this.allReceived(addr.address) : await aurora.deposits(addr.address, "received");
      // Payout lists only matter when a deposit here is waiting for its payout:
      // one already recorded, or one seen for the first time just now. An idle
      // address costs one Aurora call per poll instead of three.
      // A deposit waiting more than a day is checked every 30 minutes, not every poll: a standing address is
      // polled every minute for new money, and a payout that late is a support case, not a race.
      const waiting = await this.awaitingPayout(addr.id, received);
      const nowMs = this.now().getTime();
      let check = waiting === "fresh" || (waiting === "stale" && nowMs - (this.payoutCheckedAt.get(addr.id) ?? 0) >= STALE_PAYOUT_CHECK_MS);
      if (check) this.payoutCheckedAt.set(addr.id, nowMs);
      else if (!waiting) this.payoutCheckedAt.delete(addr.id);

      // ⚠️ Aurora can pay a deposit out without ever listing it as "received" (the 4.99 USDC case). Then the
      // received list is empty, nothing is "waiting", and the payout lists would never be read: the invoice
      // expires as unpaid while the money sits in the merchant's wallet. So once the deadline has passed and
      // nothing is on record for this address, read them: every poll while the invoice is still open (it is
      // about to close, and closing must not hide a payout), and once per STALE_PAYOUT_CHECK_MS after that.
      if (!check && !received.length && addr.invoice.kind !== "STANDING" && addr.invoice.expiresAt.getTime() <= nowMs) {
        const stillOpen = addr.invoice.status === "PENDING" || addr.invoice.status === "DETECTED";
        const due = stillOpen || nowMs - (this.unlistedCheckedAt.get(addr.id) ?? 0) >= STALE_PAYOUT_CHECK_MS;
        if (due && (await db.payment.count({ where: { invoiceAddressId: addr.id } })) === 0) {
          check = true;
          this.unlistedCheckedAt.set(addr.id, nowMs);
          if (this.unlistedCheckedAt.size > 5_000) for (const [k, at] of this.unlistedCheckedAt) if (nowMs - at > 2 * 3_600_000) this.unlistedCheckedAt.delete(k);
        }
      }
      const [success, failed] = check
        ? await Promise.all([aurora.deposits(addr.address, "success"), aurora.deposits(addr.address, "failed")])
        : [[], []];
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

    logger.debug(
      { addressId: addr.id, address: addr.address, invoiceId: addr.invoiceId, invoiceStatus: addr.invoice.status, kind: addr.invoice.kind, received: lists.received.length, success: lists.success.length, failed: lists.failed.length },
      "address polled",
    );

    const deposits = await this.valueDeposits(lists.received);
    const outcomeValues = await this.valueOutcomes([...lists.success, ...lists.failed]);
    // Filled inside the transaction, reported after it commits: a rolled-back poll must not leave a log line claiming a deposit was recorded.
    let recorded: typeof deposits = [];
    let outcomes: ResolvedOutcome[] = [];
    // Deposits folded into a payment that was recorded from its payout alone (already announced), and payments this poll made.
    let mergedHashes = new Set<string>();
    let newPayments = 0;

    const transitions = await db.$transaction(async (tx) => {
      await lockInvoice(tx, addr.invoiceId);

      if (deposits.length) {
        const have = new Set(
          (await tx.payment.findMany({ where: { auroraTxHash: { in: deposits.map((d) => d.raw.tx_hash) } }, select: { auroraTxHash: true } })).map((p) => p.auroraTxHash),
        );
        recorded = deposits.filter((d) => !have.has(d.raw.tx_hash));
        const merged = await this.mergeIntoPayoutOnly(tx, addr, recorded);
        mergedHashes = merged;
        const created = await tx.payment.createMany({
          data: deposits.filter((d) => !merged.has(d.raw.tx_hash)).map((d) => ({
            invoiceId: addr.invoiceId,
            invoiceAddressId: addr.id,
            auroraTxHash: d.raw.tx_hash,
            fromChain: tenderChainName(d.raw.fromChain ?? chainFromAssetId(d.raw.asset_id)),
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
        newPayments += created.count;
      }

      const resolved = [
        ...(await this.recordOutcomes(tx, addr, lists.success, "SETTLED", outcomeValues)),
        ...(await this.recordOutcomes(tx, addr, lists.failed, "FAILED", outcomeValues)),
      ];
      outcomes = resolved;
      newPayments += resolved.filter((r) => r.created).length;

      await tx.invoiceAddress.update({
        where: { id: addr.id },
        data: {
          pollFailures: 0,
          lastPolledOkAt: this.now(),
          nextPollAt: new Date(this.now().getTime() + this.pollEveryMs(addr.invoice.status, addr.invoice.kind, addr.invoice.expiresAt, (addr.invoice._count?.payments ?? 1) === 0 && newPayments === 0)),
        },
      });

      // A standing deposit address is not a bill: nothing is judged, nothing
      // closes. Each payment that resolved is reported on its own.
      if (addr.invoice.kind === "STANDING") {
        await this.notifyDeposits(tx, addr.invoiceId, resolved);
        return [];
      }

      // Polling one address never closes an invoice: its other addresses may
      // hold a payment not seen yet. Closing is expireDue's job alone.
      const moved = await this.settle(tx, addr.invoiceId, { mayClose: false });

      // Money recorded on an invoice that had already closed, and did not change its status (a status change
      // already notifies the merchant): say so, or the merchant only ever heard "expired".
      if (!moved.length && CLOSED_STATUSES.includes(addr.invoice.status)) {
        // A deposit folded into a payment recorded earlier from its payout was announced then: not again.
        const hashes = [...recorded.map((d) => d.raw.tx_hash).filter((h) => !mergedHashes.has(h)), ...resolved.filter((r) => r.created).map((r) => r.paymentId)];
        const ids = (
          await tx.payment.findMany({
            where: { invoiceAddressId: addr.id, OR: [{ auroraTxHash: { in: hashes } }, { id: { in: hashes } }] },
            select: { id: true },
          })
        ).map((p) => p.id);
        await notifyLatePayments(tx, addr.invoiceId, ids, { now: this.now() });
      }
      return moved;
    });

    this.reportDeposits(addr, recorded, outcomes);
    await this.publish(transitions);
    return transitions.length;
  }

  /** One structured line per deposit recorded and per payout outcome, so any payment can be traced from the logs alone. */
  private reportDeposits(
    addr: { id: string; address: string; invoiceId: string; invoice: { status: string; kind: InvoiceKind; expiresAt: Date } },
    recorded: Array<{ raw: Deposit; amountIn: string; amountInUsd: string | null }>,
    outcomes: ResolvedOutcome[],
  ) {
    const { logger } = this.deps;
    for (const d of recorded) {
      const chain = tenderChainName(d.raw.fromChain ?? chainFromAssetId(d.raw.asset_id));
      const known = chainById(chain) !== undefined;
      const fields = {
        addressId: addr.id,
        address: addr.address,
        invoiceId: addr.invoiceId,
        invoiceStatus: addr.invoice.status,
        kind: addr.invoice.kind,
        tx: d.raw.tx_hash,
        fromChain: chain,
        auroraChain: d.raw.fromChain ?? null,
        asset: d.raw.asset_id,
        amountIn: d.amountIn,
        amountInUsd: d.amountInUsd,
        sender: d.raw.from ?? null,
        recipient: d.raw.recipient,
        intentsAccount: d.raw.intents_account,
        depositedAt: d.raw.created_at,
      };
      logger.info(fields, "deposit recorded");
      // Money is real but nothing in the product expects it. Loud, once per deposit. "Unknown" (Aurora named no
      // chain and the asset id carries none) is a different problem from a chain Tender does not offer.
      if (chain === "unknown") logger.warn({ ...fields }, "deposit origin chain unknown");
      else if (!known) logger.warn({ ...fields }, "deposit from a chain Tender does not list");
      if (d.amountInUsd === null) logger.warn({ tx: d.raw.tx_hash, asset: d.raw.asset_id, address: addr.address }, "deposit recorded without a USD value");
    }
    for (const o of outcomes) {
      logger[o.status === "FAILED" ? "warn" : "info"]({ addressId: addr.id, address: addr.address, invoiceId: addr.invoiceId, paymentId: o.paymentId, outcome: o.status }, "deposit payout outcome recorded");
    }
  }

  /**
   * Reports a payment that has been DETECTED for too long: Aurora took the deposit but has not
   * paid it out and has not said it failed. Nothing else watches for this, so it is named here.
   */
  private async sweepStuck(): Promise<void> {
    const now = this.now().getTime();
    if (now - this.lastStuckSweep < STUCK_SWEEP_EVERY_MS) return;
    this.lastStuckSweep = now;
    const cutoff = new Date(now - STUCK_AFTER_MS);
    const stuck = await this.deps.db.payment.findMany({
      where: { status: "DETECTED", outcomeTxHash: null, firstSeenAt: { lt: cutoff } },
      // Newest first: a fresh stall must never be crowded out by old ones that are already being handled.
      orderBy: { firstSeenAt: "desc" },
      take: STUCK_BATCH,
      select: { id: true, invoiceId: true, invoiceAddressId: true, auroraTxHash: true, fromChain: true, assetIn: true, amountIn: true, amountInUsd: true, firstSeenAt: true },
    });
    for (const p of stuck) {
      const last = this.stuckReportedAt.get(p.id) ?? 0;
      const waitingMs = now - p.firstSeenAt.getTime();
      if (now - last < (waitingMs >= STUCK_LONG_AFTER_MS ? STUCK_LONG_REPORT_EVERY_MS : STUCK_REPORT_EVERY_MS)) continue;
      this.stuckReportedAt.set(p.id, now);
      this.deps.logger.warn(
        {
          paymentId: p.id,
          invoiceId: p.invoiceId,
          addressId: p.invoiceAddressId,
          tx: p.auroraTxHash,
          fromChain: p.fromChain,
          asset: p.assetIn,
          amountIn: p.amountIn?.toString(),
          amountInUsd: p.amountInUsd?.toString() ?? null,
          waitingMinutes: Math.round(waitingMs / 60_000),
        },
        "deposit received by Aurora but not paid out yet",
      );
    }
    // Forget payments that resolved so the map does not grow for the life of the process.
    const live = new Set(stuck.map((p) => p.id));
    for (const id of this.stuckReportedAt.keys()) if (!live.has(id)) this.stuckReportedAt.delete(id);
  }

  /**
   * Every received deposit on a standing address, page by page. Aurora paginates
   * this list and a standing address only ever grows, so reading one page would
   * eventually stop seeing new money. Capped so one address cannot hold a poll
   * open forever.
   *
   * ⚠️ Every poll starts again from the first page, and Aurora does not document
   * the list's order. If it is oldest-first, deposits past the cap are never
   * read. That is a lot of deposits for one address, but it must not happen
   * silently, so hitting the cap is logged as an error (once per address, until the worker restarts).
   */
  private async allReceived(address: string): Promise<Deposit[]> {
    const all: Deposit[] = [];
    for (let page = 0; page < STANDING_MAX_PAGES; page++) {
      const batch = await this.deps.aurora.deposits(address, "received", { limit: STANDING_PAGE, offset: page * STANDING_PAGE });
      all.push(...batch);
      if (batch.length < STANDING_PAGE) return all;
    }
    // Once per address per process: every poll of this address would otherwise repeat it, for as long as it stays that big.
    this.skipOnce(`page-cap:${address}`, { address, read: all.length, cap: STANDING_PAGE * STANDING_MAX_PAGES }, "standing address deposit list hit the page cap: newer deposits may not be read");
    return all;
  }

  /**
   * Whether anything on this address still needs its payout recorded: a deposit
   * not yet paid out, a failed payout whose recovery is still open (Aurora may
   * complete it later), or a deposit in `received` that we have not recorded yet.
   * "fresh" when the newest such deposit is under a day old (checked every poll), "stale" after that.
   */
  private async awaitingPayout(addressId: string, received: Deposit[]): Promise<"fresh" | "stale" | false> {
    // A deposit seen for the first time just now: its payout is checked straight away.
    if (received.length) {
      const known = await this.deps.db.payment.count({ where: { auroraTxHash: { in: received.map((d) => d.tx_hash) } } });
      if (known < new Set(received.map((d) => d.tx_hash)).size) return "fresh";
    }
    const waiting = await this.deps.db.payment.findFirst({
      where: {
        invoiceAddressId: addressId,
        OR: [
          { status: "DETECTED", outcomeTxHash: null },
          { status: "FAILED", recovery: { state: { in: ["OPEN", "RETRYING"] } } },
        ],
      },
      orderBy: { firstSeenAt: "desc" },
      select: { firstSeenAt: true },
    });
    if (!waiting) return false;
    return this.now().getTime() - waiting.firstSeenAt.getTime() < STALE_PAYOUT_AFTER_MS ? "fresh" : "stale";
  }

  /** Open invoices are watched closely; closed ones only for late money; past that, only a stalled deposit, slowly. */
  private pollEveryMs(invoiceStatus: string, kind: InvoiceKind, expiresAt: Date, unpaid = false): number {
    const { intervalMs, closedIntervalMs, lateWindowHours } = this.deps.config;
    // A standing address is open forever, so it is polled at the slow rate: it is
    // never waiting on one buyer's payment, and each poll is three Aurora calls.
    if (kind === "STANDING") return closedIntervalMs;
    if (invoiceStatus === "PENDING" || invoiceStatus === "DETECTED") return intervalMs;
    // Past the late window the address is only being watched for a stalled deposit (see pollDue).
    const sinceClose = this.now().getTime() - expiresAt.getTime();
    // A closed invoice with no payment on it is watched only for late money. At the once-a-minute rate, one abandoned
    // invoice cost roughly 1,400 Aurora calls per address over the late window, ahead of invoices people are paying.
    if (unpaid && sinceClose <= lateWindowHours * 3_600_000) return CLOSED_UNPAID_MS;
    if (sinceClose <= lateWindowHours * 3_600_000) return closedIntervalMs;
    return sinceClose <= STALL_FAST_DAYS * 86_400_000 ? STALL_FAST_MS : STALL_SLOW_MS;
  }

  /** Queues a webhook for each deposit on a standing address that has just settled or failed. */
  private notifyDeposits(tx: Tx, invoiceId: string, resolved: ResolvedOutcome[]) {
    return notifyDepositOutcomes(tx, invoiceId, resolved, { now: this.now() });
  }

  /** Deposits already reported as skipped: the address is polled every few seconds, so each is named once. */
  private readonly skippedReported = new Set<string>();
  private skipOnce(tx: string, fields: object, message: string) {
    if (this.skippedReported.has(tx)) return;
    if (this.skippedReported.size >= 2_000) this.skippedReported.clear();
    this.skippedReported.add(tx);
    this.deps.logger.error(fields, message);
  }

  /** Converts base units and prices each deposit. Entries we cannot read are skipped loudly, never guessed. */
  private async valueDeposits(received: Deposit[]) {
    const out: Array<{ raw: Deposit; amountIn: string; amountInUsd: string | null }> = [];
    for (const raw of received) {
      if (raw.decimals === null) {
        this.skipOnce(raw.tx_hash, { tx: raw.tx_hash, asset: raw.asset_id }, "deposit has no decimals; cannot value it — skipped");
        continue;
      }
      // An amount that is not a whole number of base units, or a time that is not a time, cannot be recorded
      // truthfully. It must not throw: one such entry would otherwise block every other deposit on the address.
      let amountIn: string;
      try {
        amountIn = fromBaseUnits(raw.amount, raw.decimals);
      } catch {
        this.skipOnce(raw.tx_hash, { tx: raw.tx_hash, asset: raw.asset_id, amount: raw.amount }, "deposit amount is not a whole number of base units — skipped");
        continue;
      }
      if (Number.isNaN(new Date(raw.created_at).getTime())) {
        this.skipOnce(raw.tx_hash, { tx: raw.tx_hash, asset: raw.asset_id, createdAt: raw.created_at }, "deposit has an unreadable time — skipped");
        continue;
      }
      const price = await this.deps.prices.usd(raw.asset_id).catch(() => null);
      if (price === null) this.deps.logger.warn({ tx: raw.tx_hash, asset: raw.asset_id }, "no USD price for deposit asset");
      out.push({ raw, amountIn, amountInUsd: price === null ? null : new Decimal(amountIn).mul(price).toFixed(18) });
    }
    return out;
  }

  /** Matches new payout outcomes to open deposits on this address and records them. */
  private async recordOutcomes(
    tx: Tx,
    addr: { id: string; invoiceId: string },
    outcomes: Deposit[],
    status: "SETTLED" | "FAILED",
    values: Map<string, OutcomeValue>,
  ): Promise<ResolvedOutcome[]> {
    const resolved: ResolvedOutcome[] = [];
    if (!outcomes.length) return resolved;

    // Every outcome already recorded on this address. A payment keeps the
    // entries it was matched to in `raw`, so a failure that was later
    // superseded by a success is still recognised as seen.
    const onAddress = await tx.payment.findMany({
      where: { invoiceAddressId: addr.id },
      select: { id: true, auroraTxHash: true, firstSeenAt: true, amountInUsd: true, raw: true, status: true, outcomeTxHash: true, recovery: true },
    });
    const seen = new Set<string>();
    for (const p of onAddress) {
      if (p.outcomeTxHash) seen.add(p.outcomeTxHash);
      const raw = p.raw as { success?: { tx_hash?: string }; failed?: { tx_hash?: string } } | null;
      if (raw?.success?.tx_hash) seen.add(raw.success.tx_hash);
      if (raw?.failed?.tx_hash) seen.add(raw.failed.tx_hash);
    }
    const fresh = outcomes.filter((o) => !seen.has(o.tx_hash));
    if (!fresh.length) return resolved;

    const open = onAddress.filter((p) => p.status === "DETECTED" && !p.outcomeTxHash);
    const { pairs, orphans, weak } = matchOutcomes(open, fresh);

    for (const { paymentId, outcome } of pairs) {
      // A SETTLED payout paired by a guess only changes which deposit shows the payout. A FAILED one opens a recovery
      // task and sends a deposit.failed webhook, so it is never pinned on a deposit by a guess: the payment it names
      // might be fine, and the one that failed left unseen. It stays unrecorded, and is named once.
      if (status === "FAILED" && weak.includes(outcome.tx_hash)) {
        this.skipOnce(outcome.tx_hash, { addressId: addr.id, invoiceId: addr.invoiceId, payout: outcome.tx_hash, waiting: open.length }, "a failed payout could belong to any of several waiting deposits: not applied, needs a manual look");
        continue;
      }
      await this.applyOutcome(tx, onAddress.find((p) => p.id === paymentId)!, outcome as Deposit, status);
      resolved.push({ paymentId, status });
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
        resolved.push({ paymentId, status: "SETTLED" });
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

    // A payout with no deposit to pair it with: Aurora paid (or failed to pay) money it never listed as
    // received. The money is real, so it is recorded from the payout alone and flagged, never left as a log line.
    for (const o of leftover) {
      const v = values.get(o.tx_hash);
      const payment = await tx.payment.create({
        data: {
          invoiceId: addr.invoiceId,
          invoiceAddressId: addr.id,
          // Not a deposit hash: the deposit is unknown. Replaced if Aurora ever lists it (see mergeIntoPayoutOnly).
          auroraTxHash: `${PAYOUT_ONLY_PREFIX}${o.tx_hash}`,
          fromChain: "unknown",
          assetIn: (o as Deposit).asset_id,
          amountIn: v?.amount ?? "0",
          amountInUsd: v?.usd ?? null,
          status,
          outcomeTxHash: o.tx_hash,
          amountSettled: status === "SETTLED" ? (v?.amount ?? null) : null,
          settledAt: status === "SETTLED" ? new Date(o.created_at) : null,
          // The payout time: all that is known. It is not the time the buyer paid.
          firstSeenAt: new Date(o.created_at),
          raw: { fromPayoutOnly: true, [status === "SETTLED" ? "success" : "failed"]: o } as Prisma.InputJsonValue,
        },
      });
      if (status === "FAILED") {
        await tx.recoveryTask.create({ data: { paymentId: payment.id, reason: "Aurora reported a failed payout for a deposit it never listed as received" } });
      }
      resolved.push({ paymentId: payment.id, status, created: true });
      this.deps.logger.error(
        { addressId: addr.id, invoiceId: addr.invoiceId, paymentId: payment.id, payout: o.tx_hash, status, amount: v?.amount ?? null },
        "payment recorded from the payout list only: Aurora never listed the deposit as received",
      );
    }
    return resolved;
  }

  /** What each payout is worth: its amount in whole tokens and in USD. Unreadable or unpriced ones are null, never guessed. */
  private async valueOutcomes(outcomes: Deposit[]): Promise<Map<string, OutcomeValue>> {
    const out = new Map<string, OutcomeValue>();
    for (const o of outcomes) {
      let amount: string | null = null;
      try {
        if (o.decimals !== null) amount = fromBaseUnits(o.amount, o.decimals);
      } catch {
        amount = null;
      }
      const price = amount !== null && o.asset_id ? await this.deps.prices.usd(o.asset_id).catch(() => null) : null;
      out.set(o.tx_hash, { amount, usd: amount !== null && price !== null ? new Decimal(amount).mul(price).toFixed(18) : null });
    }
    return out;
  }

  /**
   * A deposit Aurora lists late, for money already recorded from its payout alone. Counting both would count the
   * money twice, so the payout-only payment becomes the deposit's: it keeps its payout and takes the deposit's
   * hash, amount and time. Returns the deposits it absorbed.
   */
  private async mergeIntoPayoutOnly(
    tx: Tx,
    addr: { id: string },
    fresh: Array<{ raw: Deposit; amountIn: string; amountInUsd: string | null }>,
  ): Promise<Set<string>> {
    const merged = new Set<string>();
    if (!fresh.length) return merged;
    const candidates = (
      await tx.payment.findMany({ where: { invoiceAddressId: addr.id, auroraTxHash: { startsWith: PAYOUT_ONLY_PREFIX } } })
    ).map((p) => ({ id: p.id, paidUsd: p.amountSettled ? new Decimal(p.amountSettled.toString()) : null, paidAt: p.firstSeenAt, row: p }));
    for (const d of [...fresh].sort((a, b) => a.raw.created_at.localeCompare(b.raw.created_at))) {
      const id = matchPayoutToDeposit(candidates, { usd: d.amountInUsd === null ? null : new Decimal(d.amountInUsd), at: new Date(d.raw.created_at) });
      if (!id) continue;
      const c = candidates.splice(
        candidates.findIndex((x) => x.id === id),
        1,
      )[0]!;
      await tx.payment.update({
        where: { id },
        data: {
          auroraTxHash: d.raw.tx_hash,
          fromChain: tenderChainName(d.raw.fromChain ?? chainFromAssetId(d.raw.asset_id)),
          assetIn: d.raw.asset_id,
          amountIn: d.amountIn,
          amountInUsd: d.amountInUsd,
          firstSeenAt: new Date(d.raw.created_at),
          raw: { ...(c.row.raw as Record<string, unknown>), fromPayoutOnly: false, mergedFromPayoutOnly: true, received: d.raw } as Prisma.InputJsonValue,
        },
      });
      merged.add(d.raw.tx_hash);
      this.deps.logger.info({ paymentId: id, deposit: d.raw.tx_hash }, "payout-only payment matched to the deposit Aurora listed late");
    }
    return merged;
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


  /** See settleInvoice. Must be called with the invoice row locked. */
  private settle(tx: Tx, invoiceId: string, opts: { mayClose: boolean }): Promise<Transition[]> {
    const { graceMinutes, toleranceBps } = this.deps.config;
    return settleInvoice(tx, invoiceId, opts, { now: this.now(), graceMinutes, toleranceBps, logger: this.deps.logger });
  }

  /**
   * Repairs payments recorded with no USD value. Until the asset-id fix (see `assetKey`), no
   * price was ever found, so every payment was stored at "unknown" and judged as $0: invoices
   * paid in full were closed as UNDERPAID. Idempotent, so it simply runs at worker start.
   *
   * Valuation: a dollar stablecoin is worth today what it was worth then, so it is priced now.
   * Anything else has moved since, and its price at detection was never recorded, so it is
   * valued at what actually SETTLED: a floor, since the buyer sent at least that much.
   *
   * Then the invoice is judged again: an UNDERPAID one, and an OPEN one (a part that could not be
   * priced when it arrived counts for nothing until it is, so the invoice was waiting on it). Only a
   * payment that now covers the amount moves it (to SETTLED or OVERPAID), through the normal path:
   * history event, webhook and live update.
   *
   * Cheap to run often: with nothing unvalued it is one query that returns no rows.
   */
  async repairUnvalued(): Promise<{ valued: number; reopened: number }> {
    const out = { valued: 0, reopened: 0 };
    const rows = await this.deps.db.payment.findMany({
      where: { amountInUsd: null, assetIn: { not: null } },
      take: 500,
      include: { invoice: { select: { id: true, status: true, kind: true } } },
    });
    const recheck = new Set<string>();
    const recheckOpen = new Set<string>();
    for (const p of rows) {
      const price = await this.deps.prices.usd(p.assetIn).catch(() => null);
      if (price === null) continue;
      const stable = price > 0.97 && price < 1.03;
      const usd = stable || !p.amountSettled ? new Decimal(p.amountIn.toString()).mul(price) : new Decimal(p.amountSettled.toString());
      await this.deps.db.payment.updateMany({ where: { id: p.id, amountInUsd: null }, data: { amountInUsd: usd.toDecimalPlaces(18).toFixed() } });
      out.valued += 1;
      if (p.invoice.kind === "STANDARD" && p.invoice.status === "UNDERPAID") recheck.add(p.invoice.id);
      if (p.invoice.kind === "STANDARD" && (p.invoice.status === "PENDING" || p.invoice.status === "DETECTED")) recheckOpen.add(p.invoice.id);
    }

    // An open invoice: re-judge it now that a part has a value, without closing it.
    for (const invoiceId of recheckOpen) {
      const transitions = await this.deps.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
        return this.settle(tx, invoiceId, { mayClose: false });
      });
      if (transitions.length) {
        out.reopened += 1;
        await this.publish(transitions);
      }
    }

    for (const invoiceId of recheck) {
      const transitions = await this.deps.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
        const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { orderBy: { firstSeenAt: "asc" } } } });
        if (invoice.status !== "UNDERPAID") return [];
        // Judged on exactly the payments `settle` will count (none that arrived after the window
        // closed). Judging on more could say SETTLED here, then `settle` re-closes it as
        // UNDERPAID and sends the merchant a second underpaid webhook for nothing.
        const closesAt = new Date(invoice.expiresAt.getTime() + this.deps.config.graceMinutes * 60_000);
        const counted = invoice.payments.filter((p) => p.firstSeenAt <= closesAt);
        const next = judge({
          status: "DETECTED",
          amountExpected: invoice.amountExpected.toString(),
          payments: counted.map((p) => ({ status: p.status, amountInUsd: p.amountInUsd?.toString() ?? null })),
          closed: true,
          toleranceBps: this.deps.config.toleranceBps,
        });
        // Still short with real values: UNDERPAID was right, leave it alone.
        if (next !== "SETTLED" && next !== "OVERPAID") return [];
        // Reopened to DETECTED only inside this transaction, so `settle` can make the move itself.
        await tx.invoice.update({ where: { id: invoiceId }, data: { status: "DETECTED" } });
        return this.settle(tx, invoiceId, { mayClose: true });
      });
      if (transitions.length) {
        out.reopened += 1;
        await this.publish(transitions);
      }
    }
    return out;
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
    // Walked in pages, oldest first. A fixed first page would be the same rows every time: invoices that cannot be closed
    // yet (an address not polled since the window ended) would sit at the front and starve everything behind them.
    let changed = 0;
    let cursor: string | undefined;
    for (let page = 0; page < MAX_EXPIRE_PAGES; page++) {
      const candidates = await this.deps.db.invoice.findMany({
        where: { status: { in: ["PENDING", "DETECTED"] }, expiresAt: { lt: new Date(now.getTime() - graceMs) } },
        select: { id: true, expiresAt: true, addresses: { select: { pollFailures: true, lastPolledOkAt: true } } },
        orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
        take: this.deps.config.batchSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (candidates.length === 0) break;
      cursor = candidates.at(-1)!.id;

      for (const inv of candidates) {
        const closesAt = inv.expiresAt.getTime() + graceMs;
        // Recorded, not inferred from nextPollAt: back-off and a long queue both push nextPollAt into the future,
        // which used to read as "polled after the window closed" for an address that had not been.
        const polledSinceClose = inv.addresses.every((a) => a.pollFailures === 0 && a.lastPolledOkAt !== null && a.lastPolledOkAt.getTime() >= closesAt);
        if (!polledSinceClose) continue;

        const transitions = await this.deps.db.$transaction(async (tx) => {
          await lockInvoice(tx, inv.id);
          return this.settle(tx, inv.id, { mayClose: true });
        });
        await this.publish(transitions);
        changed += transitions.length;
      }
      if (candidates.length < this.deps.config.batchSize) break;
    }
    return changed;
  }

  private async publish(transitions: Transition[]) {
    await publishTransitions(this.deps.redis as Redis, this.deps.logger, transitions);
  }
}

async function lockInvoice(tx: Tx, invoiceId: string) {
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
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
