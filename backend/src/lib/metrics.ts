import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * Prometheus metrics (BACKEND.md §6.9, §10 step 12). One registry per
 * process: the API and the worker each expose their own /metrics.
 *
 * Labels are low-cardinality on purpose: route TEMPLATES, never raw URLs,
 * ids or addresses.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "tender_" });

export const httpRequests = new Histogram({
  name: "tender_http_request_seconds",
  help: "HTTP request duration by route template and status",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const auroraRequests = new Histogram({
  name: "tender_aurora_request_seconds",
  help: "Aurora API call duration by route and outcome (ok, or the error kind)",
  labelNames: ["route", "outcome"] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const pollerTicks = new Histogram({
  name: "tender_poller_tick_seconds",
  help: "Duration of one full poller pass",
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const depositsSeen = new Counter({
  name: "tender_deposits_seen_total",
  help: "New deposits recorded from Aurora's received lists",
  registers: [registry],
});

export const invoiceTransitions = new Counter({
  name: "tender_invoice_transitions_total",
  help: "Invoice status changes, by the status entered",
  labelNames: ["to"] as const,
  registers: [registry],
});

export const webhookDeliveries = new Counter({
  name: "tender_webhook_deliveries_total",
  help: "Webhook delivery attempts by outcome",
  labelNames: ["outcome"] as const,
  registers: [registry],
});
