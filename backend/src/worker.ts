/**
 * The background process: the poller (and, later, webhook delivery and
 * recovery). Runs separately from the API so a slow Aurora never holds up an
 * HTTP request, and so either can restart without the other.
 *
 *   npm run worker
 */
import { createServer } from "node:http";
import { Redis } from "ioredis";
import { AuroraClient } from "./aurora/client.js";
import { PriceBook } from "./aurora/prices.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { createLogger } from "./lib/logger.js";
import { registry } from "./lib/metrics.js";
import { registerWorkerGauges } from "./lib/worker-gauges.js";
import { ChainCatalogueReader, measureCatalogue, saveCatalogue } from "./services/chains.service.js";
import { startLoop } from "./workers/loop.js";
import { Poller } from "./workers/poller.js";
import { EmailWorker } from "./workers/email.worker.js";
import { WebhookWorker } from "./workers/webhook.worker.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file: real environments set variables directly.
}

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL, config.NODE_ENV === "development");
const db = createDb(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL);
const aurora = new AuroraClient({
  baseUrl: config.AURORA_API_URL,
  apiKey: config.AURORA_API_KEY,
  logger: logger.child({ component: "aurora" }),
});

// Quoting is slow and background-only: its own client, with a longer timeout
// and fewer retries, so it never competes with the poller's requests.
const quoteClient = new AuroraClient({
  baseUrl: config.AURORA_API_URL,
  apiKey: config.AURORA_API_KEY,
  logger: logger.child({ component: "aurora-quotes" }),
  timeoutMs: 30_000,
  maxAttempts: 2,
});

const poller = new Poller({
  db,
  aurora,
  prices: new PriceBook(aurora),
  redis,
  logger: logger.child({ component: "poller" }),
  config: {
    intervalMs: config.POLL_INTERVAL_MS,
    closedIntervalMs: config.POLL_CLOSED_INTERVAL_MS,
    toleranceBps: config.PAYMENT_TOLERANCE_BPS,
    graceMinutes: config.EXPIRY_GRACE_MINUTES,
    lateWindowHours: config.LATE_WINDOW_HOURS,
    concurrency: config.POLL_CONCURRENCY,
    batchSize: config.POLL_BATCH_SIZE,
  },
});

let closing = false;

registerWorkerGauges({ db, catalogue: new ChainCatalogueReader(redis, 0) });

poller.start();

const webhookLog = logger.child({ component: "webhooks" });
const webhooks = new WebhookWorker({ db, logger: webhookLog });
const webhookLoop = startLoop("webhooks", 2_000, () => webhooks.tick(), webhookLog);

// Welcome email: only runs when a Resend key is set (the API queues nothing without one).
const emailLog = logger.child({ component: "email" });
const emailLoop = config.RESEND_API_KEY
  ? startLoop(
      "email",
      5_000,
      () =>
        new EmailWorker({
          db,
          logger: emailLog,
          config: { apiKey: config.RESEND_API_KEY!, from: config.EMAIL_FROM, replyTo: config.EMAIL_REPLY_TO, appUrl: config.APP_URL },
        }).tick(),
      emailLog,
    )
  : undefined;
if (!emailLoop) emailLog.info("RESEND_API_KEY not set: welcome emails are off");

// The worker's own /metrics: poller, webhook and Aurora metrics live in this process.
const metricsServer = createServer(async (req, res) => {
  const authorised = !config.METRICS_TOKEN || req.headers.authorization === `Bearer ${config.METRICS_TOKEN}`;
  if (req.url !== "/metrics" || !authorised) {
    res.statusCode = req.url === "/metrics" ? 401 : 404;
    return res.end();
  }
  res.setHeader("content-type", registry.contentType);
  res.end(await registry.metrics());
});
metricsServer.listen(config.WORKER_METRICS_PORT);

logger.info({ intervalMs: config.POLL_INTERVAL_MS, metricsPort: config.WORKER_METRICS_PORT }, "worker started");

/**
 * Re-measures per-chain minimums on a schedule (see chains.service.ts).
 * Dry quotes need a real Monad recipient, so a verified merchant's
 * settlement address is used; with no verified merchant yet, it waits.
 */
const catalogueLog = logger.child({ component: "minimums" });
let catalogueTimer: NodeJS.Timeout | undefined;
async function refreshCatalogue() {
  try {
    const merchant = await db.merchant.findFirst({
      where: { settlementVerified: true, settlementAddress: { not: null } },
      select: { settlementAddress: true },
    });
    if (!merchant?.settlementAddress) {
      catalogueLog.warn("no verified merchant yet; minimums not measured");
      return;
    }
    const started = Date.now();
    // A full run takes ~7 minutes for 30 chains. With nothing cached yet (a cold
    // start, or after the cache expired) /public/chains would answer 503 for all
    // of it, so publish each chain as it is measured. With a previous catalogue
    // in place, leave it alone until the new one is complete: a partial result
    // must never replace a full one.
    const hadCatalogue = (await new ChainCatalogueReader(redis, 0).get()) !== null;
    const catalogue = await measureCatalogue(quoteClient, {
      recipient: merchant.settlementAddress,
      marginBps: config.MINIMUM_MARGIN_BPS,
      logger: catalogueLog,
      onProgress: hadCatalogue ? undefined : (partial) => saveCatalogue(redis, partial),
    });
    await saveCatalogue(redis, catalogue);
    catalogueLog.info(
      { chains: catalogue.chains.map((c) => `${c.id}=${c.minimum}`), ms: Date.now() - started },
      "minimums measured",
    );
  } catch (err) {
    catalogueLog.error({ err }, "minimum measurement failed; keeping the previous values until they expire");
  } finally {
    if (!closing) catalogueTimer = setTimeout(refreshCatalogue, config.MINIMUMS_REFRESH_MINUTES * 60_000);
  }
}
void refreshCatalogue();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) process.exit(1);
    closing = true;
    logger.info({ signal }, "worker shutting down");
    // Let the current tick finish: every write is transactional, but there is
    // no reason to throw away a pass that is nearly done.
    clearTimeout(catalogueTimer);
    await Promise.all([poller.stop(), webhookLoop.stop(), emailLoop?.stop()]);
    metricsServer.close();
    await Promise.allSettled([db.$disconnect(), redis.quit()]);
    process.exit(0);
  });
}
