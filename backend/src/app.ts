import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify, { type FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { ApiError } from "./lib/errors.js";
import { loggerOptions } from "./lib/logger.js";
import { httpRequests, registry } from "./lib/metrics.js";
import { registerRateLimits } from "./lib/rate-limit.js";
import { buildOpenApiDocument } from "./openapi.js";
import type { AuroraClient } from "./aurora/client.js";
import { requireMerchant } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { internalRoutes } from "./routes/internal.js";
import { invoiceRoutes } from "./routes/invoices.js";
import { merchantRoutes } from "./routes/merchants.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { paymentRoutes } from "./routes/payments.js";
import { publicRoutes } from "./routes/public.js";
import type { ChainCatalogueReader } from "./services/chains.service.js";
import type { ChainReader } from "./services/settlement-proof.service.js";
import type { InvoiceStream } from "./services/stream.js";

declare module "fastify" {
  interface FastifyInstance {
    /** Every API route, as "METHOD /path" — checked against the OpenAPI document in tests. */
    apiRoutes: string[];
  }
}

export type AppDeps = {
  config: Config;
  db: Db;
  redis: Redis;
  aurora: Pick<AuroraClient, "mintAddress" | "submitDeposit">;
  stream: InvoiceStream;
  catalogue: ChainCatalogueReader;
  /** Monad RPC reader for smart-contract wallet proofs. Optional: without it, EOAs only. */
  chain?: ChainReader;
};

/**
 * Builds the HTTP app without starting it, so tests can drive it with
 * `app.inject()` and no open port.
 */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: loggerOptions(config.LOG_LEVEL, config.NODE_ENV === "development"),
    // Behind a proxy in production; trust it for the client IP used in rate limits.
    trustProxy: config.NODE_ENV === "production",
    // SSE connections are long-lived; close them on shutdown instead of
    // waiting for every buyer to navigate away.
    forceCloseConnections: true,
  });

  // Only the checkout page calls this API from a browser, and only /public/*.
  // Merchant routes are called server-to-server and need no CORS at all.
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || config.CORS_ORIGINS.includes(origin)),
    methods: ["GET", "POST"],
  });

  // Record every API route (not Swagger's own) so tests can prove /docs covers them all.
  app.decorate("apiRoutes", [] as string[]);
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/docs")) return;
    for (const method of [route.method].flat()) {
      if (method !== "HEAD" && method !== "OPTIONS") app.apiRoutes.push(`${method} ${route.url}`);
    }
  });

  // Swagger UI at /docs, from a document generated off the contract schemas.
  await app.register(swagger, { mode: "static", specification: { document: buildOpenApiDocument() as never } });
  await app.register(swaggerUi, { routePrefix: "/docs", uiConfig: { persistAuthorization: true, displayRequestDuration: true } });

  await registerRateLimits(app, deps.redis);

  app.addHook("onResponse", async (req, reply) => {
    httpRequests.observe(
      { method: req.method, route: req.routeOptions.url ?? "unmatched", status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  });

  app.get("/metrics", async (req, reply) => {
    if (config.METRICS_TOKEN && req.headers.authorization !== `Bearer ${config.METRICS_TOKEN}`) {
      return reply.code(401).send({ error: "unauthorized", message: "Missing or invalid metrics token" });
    }
    return reply.header("content-type", registry.contentType).send(await registry.metrics());
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, fields: err.fields });
    }
    if (err instanceof ZodError) {
      const fields = Object.fromEntries(err.issues.map((i) => [i.path.join(".") || "body", i.message]));
      return reply.code(400).send({ error: "validation", message: "Request failed validation", fields });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) {
      return reply.code(429).send({ error: "rate_limited", message: (err as Error).message });
    }
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ error: "bad_request", message: (err as Error).message });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "server", message: "Internal server error" });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "not_found", message: "Route not found" }));

  healthRoutes(app, deps);
  publicRoutes(app, { ...deps, ttlMinutes: config.INVOICE_TTL_MINUTES });
  internalRoutes(app, { db: deps.db, platformKey: config.TENDER_PLATFORM_KEY });

  // Everything under /v1 requires a merchant API key (or the dashboard's platform key). The hook is scoped to
  // this plugin, so it can never leak onto /public or /health.
  await app.register(async (merchantScope) => {
    requireMerchant(merchantScope, deps.db, config.TENDER_PLATFORM_KEY);
    merchantRoutes(merchantScope, { db: deps.db, redis: deps.redis, chain: deps.chain });
    paymentRoutes(merchantScope, { db: deps.db });
    dashboardRoutes(merchantScope, { db: deps.db, aurora: deps.aurora, ttlMinutes: config.INVOICE_TTL_MINUTES });
    invoiceRoutes(merchantScope, {
      db: deps.db,
      aurora: deps.aurora,
      ttlMinutes: config.INVOICE_TTL_MINUTES,
      catalogue: deps.catalogue,
    });
  });

  return app;
}
