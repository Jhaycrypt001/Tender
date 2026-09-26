import type { Dispatcher } from "undici";
import type { Db } from "../db/client.js";
import type { Logger } from "../lib/logger.js";
import { webhookDeliveries } from "../lib/metrics.js";
import { sendWebhook } from "../services/webhook.service.js";

/**
 * Delivers the WebhookDelivery outbox (rows written in the same transaction
 * as each invoice transition).
 *
 * - At-least-once: a row is only marked delivered after a 2xx.
 * - Multi-worker safe: rows are CLAIMED with `FOR UPDATE SKIP LOCKED` and a
 *   lease, so two workers never send the same row at the same moment, and a
 *   worker that dies mid-send releases its rows when the lease runs out.
 * - Backoff: 30s, 2m, 10m, 30m, 1h, 2h, 4h, 8h — then it gives up and says so.
 */

export const RETRY_SCHEDULE_MS = [30e3, 120e3, 600e3, 1800e3, 3600e3, 7200e3, 14400e3, 28800e3];
const LEASE_MS = 60_000;

export type WebhookWorkerDeps = {
  db: Db;
  logger: Logger;
  batchSize?: number;
  now?: () => Date;
  /** Test-only override; production uses the public-only dispatcher. */
  dispatcher?: Dispatcher;
};

export class WebhookWorker {
  constructor(private readonly deps: WebhookWorkerDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async tick(): Promise<{ delivered: number; failed: number }> {
    const now = this.now();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);
    const claimed = await this.deps.db.$queryRaw<{ id: string }[]>`
      UPDATE "WebhookDelivery" SET "nextRetryAt" = ${leaseUntil}
      WHERE id IN (
        SELECT id FROM "WebhookDelivery"
        WHERE "deliveredAt" IS NULL AND "nextRetryAt" IS NOT NULL AND "nextRetryAt" <= ${now}
        ORDER BY "nextRetryAt"
        LIMIT ${this.deps.batchSize ?? 50}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id`;

    let delivered = 0;
    let failed = 0;
    for (const { id } of claimed) {
      (await this.deliver(id)) ? delivered++ : failed++;
    }
    if (claimed.length) this.deps.logger.info({ delivered, failed }, "webhook tick");
    return { delivered, failed };
  }

  /** Attempts one claimed row and records the outcome. */
  private async deliver(id: string): Promise<boolean> {
    const { db, logger } = this.deps;
    const row = await db.webhookDelivery.findUniqueOrThrow({ where: { id } });
    const merchant = await db.merchant.findUniqueOrThrow({
      where: { id: row.merchantId },
      select: { webhookUrl: true, webhookSecret: true },
    });

    // The merchant removed their endpoint after the event was queued.
    if (!merchant.webhookUrl) {
      await db.webhookDelivery.update({ where: { id }, data: { nextRetryAt: null, lastError: "no webhook_url configured" } });
      return false;
    }

    const result = await sendWebhook(merchant.webhookUrl, merchant.webhookSecret, row.payload as { id: string }, {
      dispatcher: this.deps.dispatcher,
      now: this.now(),
    });
    const attempts = row.attempts + 1;

    if (result.ok) {
      webhookDeliveries.inc({ outcome: "delivered" });
      await db.webhookDelivery.update({ where: { id }, data: { attempts, deliveredAt: this.now(), nextRetryAt: null, lastError: null } });
      return true;
    }

    const delay = RETRY_SCHEDULE_MS[attempts - 1];
    webhookDeliveries.inc({ outcome: delay === undefined ? "gave_up" : "failed" });
    await db.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        lastError: result.error,
        nextRetryAt: delay === undefined ? null : new Date(this.now().getTime() + delay),
      },
    });
    if (delay === undefined) logger.error({ deliveryId: id, event: row.event, attempts }, "webhook gave up after final attempt");
    else logger.warn({ deliveryId: id, event: row.event, attempts, error: result.error }, "webhook attempt failed");
    return false;
  }
}
