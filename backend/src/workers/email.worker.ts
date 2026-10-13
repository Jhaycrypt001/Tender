import type { Db } from "../db/client.js";
import type { Logger } from "../lib/logger.js";
import { chainById } from "../aurora/chains.js";
import {
  renderMoneyIn,
  renderMoneyOut,
  renderWelcome,
  sendEmail,
  type EmailConfig,
  type Message,
  type MoneyIn,
  type SendResult,
} from "../services/email.service.js";
import { amount } from "../services/serialize.js";
import { settledTotal } from "../services/settlement.js";

/**
 * Sends the EmailDelivery outbox, with the same guarantees as the webhook
 * worker: rows are CLAIMED with `FOR UPDATE SKIP LOCKED` and a lease, so two
 * workers never send one row at once, and a worker that dies mid-send frees
 * its rows when the lease runs out.
 *
 * Besides the welcome email there are two kinds of money email, one per money movement:
 *   payin   key "pay:<paymentId>"   a payment settled into the merchant's wallet
 *           key "short:<invoiceId>" an invoice closed with less than it asked for
 *   payout  key "out:<transferId>"  a payout, refund or split arrived
 *           key "outfail:<transferId>" it, or one of its cross-chain legs, did not
 *
 * Nothing in the poller or the transfer code queues these. `sweep` finds what has just happened in the
 * database and queues one row for it; the unique (merchant, kind, key) makes that once-only however often
 * it runs. A message is built when it is SENT, from the state then, so it is never stale.
 *
 * A failed email is not worth an alarm: a few retries with backoff, then it gives up and logs once.
 */

export const EMAIL_RETRY_MS = [60e3, 300e3, 1800e3, 7200e3];
const LEASE_MS = 120_000;
/** How often the database is searched for new money movements. */
const SWEEP_EVERY_MS = 30_000;
/** How far back a sweep looks. Anything older than this at the first sweep is history, not news. */
const RECENT_MS = 60 * 60_000;
/** Failures are noticed a little later than successes, so they get a longer look back. */
const FAILURE_LOOKBACK_MS = 24 * 60 * 60_000;

let lastSweep = 0;

export type EmailWorkerDeps = {
  db: Db;
  logger: Logger;
  config: EmailConfig;
  batchSize?: number;
  now?: () => Date;
  /** Test-only: replaces the call to Resend. */
  send?: (to: string, message: Message) => Promise<SendResult>;
};

/** What the sender decided about a claimed row: send this, or leave it unsent for a stated reason. */
type Built = { message: Message } | { skip: string };

export class EmailWorker {
  constructor(private readonly deps: EmailWorkerDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async tick(): Promise<{ sent: number; failed: number }> {
    const now = this.now();
    if (now.getTime() - lastSweep >= SWEEP_EVERY_MS) {
      lastSweep = now.getTime();
      await this.sweep().catch((err: unknown) => this.deps.logger.warn({ err }, "email sweep failed"));
    }

    const claimed = await this.deps.db.$queryRaw<{ id: string }[]>`
      UPDATE "EmailDelivery" SET "nextRetryAt" = ${new Date(now.getTime() + LEASE_MS)}
      WHERE id IN (
        SELECT id FROM "EmailDelivery"
        WHERE "sentAt" IS NULL AND "nextRetryAt" IS NOT NULL AND "nextRetryAt" <= ${now}
        ORDER BY "nextRetryAt"
        LIMIT ${this.deps.batchSize ?? 20}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;

    let sent = 0;
    let failed = 0;
    for (const { id } of claimed) (await this.deliver(id)) ? sent++ : failed++;
    if (claimed.length) this.deps.logger.info({ sent, failed }, "email tick");
    return { sent, failed };
  }

  /**
   * Queues one email for each money movement that has just happened and has none yet. Reads only our own
   * database: nothing here calls Aurora.
   */
  async sweep(): Promise<number> {
    const { db, logger } = this.deps;
    const now = this.now();
    const recent = new Date(now.getTime() - RECENT_MS);
    const failureSince = new Date(now.getTime() - FAILURE_LOOKBACK_MS);
    const rows: Array<{ merchantId: string; toEmail: string; kind: "payin" | "payout"; key: string }> = [];

    // Money in: each payment that has settled into the wallet.
    const payments = await db.payment.findMany({
      where: { status: "SETTLED", settledAt: { gte: recent }, invoice: { merchant: { emailPayIn: true } } },
      select: { id: true, invoice: { select: { merchantId: true, merchant: { select: { email: true } } } } },
      take: 200,
    });
    for (const p of payments) rows.push({ merchantId: p.invoice.merchantId, toEmail: p.invoice.merchant.email, kind: "payin", key: `pay:${p.id}` });

    // Money in: an invoice that closed short.
    const short = await db.invoice.findMany({
      where: { kind: "STANDARD", status: "UNDERPAID", updatedAt: { gte: recent }, merchant: { emailPayIn: true } },
      select: { id: true, merchantId: true, merchant: { select: { email: true } } },
      take: 200,
    });
    for (const i of short) rows.push({ merchantId: i.merchantId, toEmail: i.merchant.email, kind: "payin", key: `short:${i.id}` });

    // Money out: a transfer that confirmed and, if it goes to another chain, whose every leg has arrived.
    const sent = await db.transfer.findMany({
      where: {
        status: "CONFIRMED",
        OR: [{ confirmedAt: { gte: recent } }, { lines: { some: { destDeliveredAt: { gte: recent } } } }],
        lines: { none: { destStatus: { in: ["PENDING", "FAILED"] } } },
      },
      select: { id: true, merchantId: true, merchant: { select: { email: true } } },
      take: 200,
    });
    for (const t of sent) rows.push({ merchantId: t.merchantId, toEmail: t.merchant.email, kind: "payout", key: `out:${t.id}` });

    // Money out that did not arrive: the network refused it after it was submitted, or a cross-chain leg failed.
    const failed = await db.transfer.findMany({
      where: {
        OR: [
          // Only once it was broadcast: a send the network refused outright moved nothing, and the screen already said so.
          { status: "FAILED", txHash: { not: null }, submittedAt: { gte: failureSince } },
          { status: "CONFIRMED", confirmedAt: { gte: failureSince }, lines: { some: { destStatus: "FAILED" } } },
        ],
      },
      select: { id: true, merchantId: true, merchant: { select: { email: true } } },
      take: 200,
    });
    for (const t of failed) rows.push({ merchantId: t.merchantId, toEmail: t.merchant.email, kind: "payout", key: `outfail:${t.id}` });

    if (!rows.length) return 0;
    const { count } = await db.emailDelivery.createMany({
      data: rows.map((r) => ({ ...r, nextRetryAt: now })),
      skipDuplicates: true,
    });
    if (count) logger.info({ queued: count }, "money emails queued");
    return count;
  }

  private async deliver(id: string): Promise<boolean> {
    const { db, logger, config } = this.deps;
    const row = await db.emailDelivery.findUniqueOrThrow({ where: { id }, include: { merchant: true } });

    // Built now, from the state as it is now (see renderWelcome).
    const built = await this.build(row.kind, row.key, row.merchant, config.appUrl);
    if ("skip" in built) {
      await db.emailDelivery.update({ where: { id }, data: { sentAt: this.now(), nextRetryAt: null, lastError: `skipped: ${built.skip}` } });
      return true;
    }

    const result = await (this.deps.send ?? ((to, m) => sendEmail(config, to, m)))(row.toEmail, built.message);
    const attempts = row.attempts + 1;

    if (result.ok) {
      await db.emailDelivery.update({ where: { id }, data: { attempts, sentAt: this.now(), nextRetryAt: null, lastError: null } });
      return true;
    }

    const delay = EMAIL_RETRY_MS[attempts - 1];
    await db.emailDelivery.update({
      where: { id },
      data: { attempts, lastError: result.error, nextRetryAt: delay === undefined ? null : new Date(this.now().getTime() + delay) },
    });
    // The recipient address is deliberately not logged.
    if (delay === undefined) logger.warn({ emailId: id, kind: row.kind, attempts, error: result.error }, "email gave up");
    else logger.warn({ emailId: id, kind: row.kind, attempts, error: result.error }, "email attempt failed");
    return false;
  }

  private async build(
    kind: string,
    key: string,
    merchant: { id: string; name: string; settlementAddress: string | null; settlementVerified: boolean; emailPayIn: boolean },
    appUrl: string,
  ): Promise<Built> {
    if (kind === "welcome") return { message: renderWelcome({ ...merchant, appUrl }) };
    const [what, ref = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];

    if (kind === "payin") {
      if (!merchant.emailPayIn) return { skip: "payment emails are off" };
      return what === "pay" ? this.buildPayment(ref, appUrl) : this.buildClosedShort(ref, appUrl);
    }
    if (kind === "payout") return this.buildTransfer(ref, what === "outfail", appUrl);
    return { skip: `unknown kind ${kind}` };
  }

  private async buildPayment(paymentId: string, appUrl: string): Promise<Built> {
    const p = await this.deps.db.payment.findUnique({
      where: { id: paymentId },
      include: { invoice: { include: { payments: true } } },
    });
    if (!p || p.status !== "SETTLED") return { skip: "payment is no longer settled" };
    const inv = p.invoice;
    const base = {
      appUrl,
      at: p.settledAt ?? p.firstSeenAt,
      amount: amount(p.amountSettled ?? p.amountInUsd ?? p.amountIn),
      currency: inv.currency,
      fromChain: chainById(p.fromChain)?.name ?? p.fromChain,
      reference: inv.reference,
      invoiceId: inv.id,
    };
    if (inv.kind === "STANDING") return { message: renderMoneyIn({ ...base, variant: "deposit" }) };

    const received = amount(settledTotal(inv.payments.map((x) => ({ status: x.status, amountInUsd: x.amountInUsd?.toString() ?? null }))));
    const expected = amount(inv.amountExpected);
    const variant: MoneyIn["variant"] =
      inv.status === "OVERPAID" ? "over" : inv.status === "UNDERPAID" ? "short" : inv.status === "SETTLED" ? "received" : Number(received) < Number(expected) ? "partial" : "received";
    return { message: renderMoneyIn({ ...base, variant, received, expected }) };
  }

  private async buildClosedShort(invoiceId: string, appUrl: string): Promise<Built> {
    const inv = await this.deps.db.invoice.findUnique({ where: { id: invoiceId }, include: { payments: true } });
    if (!inv || inv.status !== "UNDERPAID") return { skip: "invoice is no longer underpaid" };
    const received = amount(settledTotal(inv.payments.map((x) => ({ status: x.status, amountInUsd: x.amountInUsd?.toString() ?? null }))));
    return {
      message: renderMoneyIn({
        appUrl,
        at: inv.updatedAt,
        variant: "short",
        amount: received,
        currency: inv.currency,
        fromChain: "",
        reference: inv.reference,
        invoiceId: inv.id,
        received,
        expected: amount(inv.amountExpected),
      }),
    };
  }

  private async buildTransfer(transferId: string, failed: boolean, appUrl: string): Promise<Built> {
    const t = await this.deps.db.transfer.findUnique({ where: { id: transferId }, include: { lines: { orderBy: { index: "asc" } } } });
    if (!t) return { skip: "transfer is gone" };
    const to = t.lines.map((l) => ({
      address: l.destAddress ?? l.toAddress,
      chain: l.destChain ? (chainById(l.destChain)?.name ?? l.destChain) : "Monad",
    }));
    const base = { appUrl, at: t.confirmedAt ?? t.submittedAt ?? t.createdAt, transferId: t.id, kind: t.kind, amount: amount(t.totalAmount), asset: t.asset, to };

    if (!failed) {
      if (t.status !== "CONFIRMED" || t.lines.some((l) => l.destStatus === "PENDING" || l.destStatus === "FAILED")) return { skip: "transfer is not complete" };
      return { message: renderMoneyOut({ ...base, variant: "sent" }) };
    }
    const lost = t.lines.find((l) => l.destStatus === "FAILED");
    if (t.status === "FAILED") return { message: renderMoneyOut({ ...base, variant: "failed", reason: t.failureReason }) };
    if (lost) {
      const where = lost.destChain ? (chainById(lost.destChain)?.name ?? lost.destChain) : "the other chain";
      return { message: renderMoneyOut({ ...base, variant: "failed", reason: `It left your wallet but did not reach ${where}. Open it to see what to do.` }) };
    }
    return { skip: "nothing failed" };
  }
}
