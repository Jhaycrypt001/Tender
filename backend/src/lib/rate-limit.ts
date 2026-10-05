import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { apiKeyPrefix } from "../services/merchant.service.js";

/**
 * Per-minute limits, stored in Redis so they hold across API instances.
 *
 * Public routes are limited per client IP. Platform-key traffic (the dashboard) is
 * limited per acted-for merchant, and never shares a bucket with merchant keys. The tightest limits sit on the two
 * that cost something real on every call: opening a payment link mints
 * Aurora addresses, and submit-tx calls Aurora. Merchant routes are limited
 * per API key (by its non-secret prefix), so one noisy integration cannot
 * starve another.
 */
type Group = { name: string; max: number };

function groupFor(req: FastifyRequest): Group {
  const url = req.routeOptions.url ?? req.url;
  if (url.startsWith("/internal/")) return { name: "internal", max: 120 };
  // Every call costs a model request, so it is far tighter than the rest, and is
  // counted per merchant whichever way they authenticate.
  if (url === "/v1/assistant/ask") return { name: "assistant", max: 10 };
  // Preparing and submitting a transfer costs Tender network fees, so POSTs here are tight and per merchant.
  if (url.startsWith("/v1/transfers") && req.method === "POST") return { name: "transfers", max: 20 };
  // The dashboard's platform key fronts every signed-in merchant, so it is
  // limited per merchant it acts for, at its own ceiling.
  if (req.headers.authorization?.startsWith("Bearer tp_")) return { name: "platform", max: 1200 };
  // Only the POST mints addresses. The GET preview is free, so it shares the ordinary public limit.
  if (url === "/public/links/:token" && req.method === "POST") return { name: "link-open", max: 10 };
  if (url === "/public/invoices/:token/submit-tx") return { name: "submit-tx", max: 10 };
  if (url === "/public/invoices/:token/events") return { name: "sse", max: 30 };
  if (url.startsWith("/public/")) return { name: "public", max: 120 };
  return { name: "merchant", max: 600 };
}

function identity(req: FastifyRequest, group: Group): string {
  const viaPlatform = req.headers.authorization?.startsWith("Bearer tp_");
  if (group.name === "platform" || ((group.name === "assistant" || group.name === "transfers") && viaPlatform)) {
    const id = req.headers["x-tender-merchant"];
    return `merchant:${typeof id === "string" ? id.slice(0, 40) : "none"}`;
  }
  if (group.name === "merchant" || group.name === "assistant" || group.name === "transfers") {
    const key = req.headers.authorization?.split(" ")[1];
    if (key) return `key:${apiKeyPrefix(key)}`;
  }
  return `ip:${req.ip}`;
}

export async function registerRateLimits(app: FastifyInstance, redis: Redis) {
  await app.register(rateLimit, {
    global: true,
    redis,
    nameSpace: "tender:rl:",
    timeWindow: 60_000,
    allowList: (req) => req.url === "/health" || req.url === "/metrics",
    max: (req) => groupFor(req).max,
    keyGenerator: (req) => {
      const group = groupFor(req);
      return `${group.name}:${identity(req, group)}`;
    },
    // Same flat error shape as every other error, which the frontend client reads.
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error: "rate_limited",
      message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)}s.`,
    }),
  });
}
