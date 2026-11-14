import { Gauge } from "prom-client";
import type { Db } from "../db/client.js";
import type { ChainCatalogueReader } from "../services/chains.service.js";
import { registry } from "./metrics.js";

/**
 * Gauges the worker exposes for alerting (docs/DEPLOY.md). They are computed
 * when Prometheus scrapes, so they are never stale and cost nothing between
 * scrapes. Each one answers "is something silently stuck?".
 */
export function registerWorkerGauges(deps: { db: Db; catalogue: ChainCatalogueReader; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  new Gauge({
    name: "tender_poll_lag_seconds",
    help: "How overdue the most overdue open invoice address is for its next poll. ~0 when the poller keeps up; growing means it is stuck or behind.",
    registers: [registry],
    async collect() {
      const oldest = await deps.db.invoiceAddress.findFirst({
        where: { invoice: { status: { in: ["PENDING", "DETECTED"] } } },
        orderBy: { nextPollAt: "asc" },
        select: { nextPollAt: true },
      });
      this.set(oldest ? Math.max(0, (now().getTime() - oldest.nextPollAt.getTime()) / 1000) : 0);
    },
  });

  new Gauge({
    name: "tender_poll_stale_seconds",
    help: "Longest time since an open invoice address was last polled successfully. Unlike poll lag this is not hidden by back-off: an Aurora outage or a permanently failing address makes it grow.",
    registers: [registry],
    async collect() {
      const open = { invoice: { status: { in: ["PENDING", "DETECTED"] as ("PENDING" | "DETECTED")[] } } };
      const stalest = await deps.db.invoiceAddress.findFirst({ where: { ...open, lastPolledOkAt: { not: null } }, orderBy: { lastPolledOkAt: "asc" }, select: { lastPolledOkAt: true } });
      // An address that has NEVER been polled successfully is the stalest of all, from the moment it was made.
      const never = await deps.db.invoiceAddress.findFirst({ where: { ...open, lastPolledOkAt: null }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
      const since = [stalest?.lastPolledOkAt, never?.createdAt].filter((d): d is Date => !!d).map((d) => d.getTime());
      this.set(since.length ? Math.max(0, (now().getTime() - Math.min(...since)) / 1000) : 0);
    },
  });

  new Gauge({
    name: "tender_poll_failing_addresses",
    help: "Open invoice addresses whose last 5 or more polls failed. Each one keeps its invoice pending: it will not be closed unpaid while it cannot be checked.",
    registers: [registry],
    async collect() {
      this.set(await deps.db.invoiceAddress.count({ where: { pollFailures: { gte: 5 }, invoice: { status: { in: ["PENDING", "DETECTED"] } } } }));
    },
  });

  new Gauge({
    name: "tender_webhook_dead_letters",
    help: "Webhook deliveries that used every retry and were given up on. Any value above 0 is a merchant who is not hearing about payments.",
    registers: [registry],
    async collect() {
      this.set(await deps.db.webhookDelivery.count({ where: { deliveredAt: null, nextRetryAt: null } }));
    },
  });

  new Gauge({
    name: "tender_chain_minimums_age_seconds",
    help: "Age of the cached per-chain minimums. -1 when none are cached. Alert above 2x MINIMUMS_REFRESH_MINUTES.",
    registers: [registry],
    async collect() {
      const catalogue = await deps.catalogue.get();
      this.set(catalogue ? Math.max(0, (now().getTime() - Date.parse(catalogue.measuredAt)) / 1000) : -1);
    },
  });
}
