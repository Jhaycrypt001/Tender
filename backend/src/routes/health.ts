import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import type { Db } from "../db/client.js";

/**
 * Liveness and readiness in one: 200 only when Postgres and Redis both answer.
 * Deliberately does not call Aurora — an Aurora outage should show up in the
 * poller's metrics, not take the whole API out of a load balancer.
 */
/** A dependency that never answers counts as down, so a load balancer gets a 503 and not a hung request. */
const PROBE_TIMEOUT_MS = 2_000;
const probe = (check: PromiseLike<unknown>) =>
  Promise.race([
    Promise.resolve(check).then(() => "ok" as const, () => "down" as const),
    new Promise<"down">((resolve) => setTimeout(() => resolve("down"), PROBE_TIMEOUT_MS).unref()),
  ]);

export function healthRoutes(app: FastifyInstance, deps: { db: Db; redis: Redis }) {
  app.get("/health", async (_req, reply) => {
    const [database, redis] = await Promise.all([probe(deps.db.$queryRaw`SELECT 1`), probe(deps.redis.ping())]);
    const ok = database === "ok" && redis === "ok";
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", database, redis });
  });
}
