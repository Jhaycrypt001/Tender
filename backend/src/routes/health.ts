import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Db } from "../db/client.js";

/**
 * Liveness and readiness in one: 200 only when Postgres and Redis both answer.
 * Deliberately does not call Aurora — an Aurora outage should show up in the
 * poller's metrics, not take the whole API out of a load balancer.
 */
export function healthRoutes(app: FastifyInstance, deps: { db: Db; redis: Redis }) {
  app.get("/health", async (_req, reply) => {
    const [database, redis] = await Promise.all([
      deps.db.$queryRaw`SELECT 1`.then(() => "ok" as const, () => "down" as const),
      deps.redis.ping().then(() => "ok" as const, () => "down" as const),
    ]);
    const ok = database === "ok" && redis === "ok";
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", database, redis });
  });
}
