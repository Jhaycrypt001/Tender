import type { Db } from "../db/client.js";
import type { Logger } from "../lib/logger.js";
import { renderWelcome, sendEmail, type EmailConfig, type Message, type SendResult } from "../services/email.service.js";

/**
 * Sends the EmailDelivery outbox, with the same guarantees as the webhook
 * worker: rows are CLAIMED with `FOR UPDATE SKIP LOCKED` and a lease, so two
 * workers never send one row at once, and a worker that dies mid-send frees
 * its rows when the lease runs out.
 *
 * A welcome email is not worth an alarm: a few retries with backoff, then it
 * gives up and logs once.
 */

export const EMAIL_RETRY_MS = [60e3, 300e3, 1800e3, 7200e3];
const LEASE_MS = 120_000;

export type EmailWorkerDeps = {
  db: Db;
  logger: Logger;
  config: EmailConfig;
  batchSize?: number;
  now?: () => Date;
  /** Test-only: replaces the call to Resend. */
  send?: (to: string, message: Message) => Promise<SendResult>;
};

export class EmailWorker {
  constructor(private readonly deps: EmailWorkerDeps) {}

  private now() {
    return this.deps.now?.() ?? new Date();
  }

  async tick(): Promise<{ sent: number; failed: number }> {
    const now = this.now();
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

  private async deliver(id: string): Promise<boolean> {
    const { db, logger, config } = this.deps;
    const row = await db.emailDelivery.findUniqueOrThrow({ where: { id }, include: { merchant: true } });

    // Built now, from the merchant as they are now (see renderWelcome).
    const message = renderWelcome({ ...row.merchant, appUrl: config.appUrl });
    const result = await (this.deps.send ?? ((to, m) => sendEmail(config, to, m)))(row.toEmail, message);
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
}
