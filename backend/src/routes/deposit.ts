import type { FastifyInstance } from "fastify";
import type { ChainCatalogueReader } from "../services/chains.service.js";
import { ensureStanding, findStanding, toDepositAddress, type StandingDeps } from "../services/standing.service.js";
import { merchantOf } from "./auth.js";

/**
 * The standing deposit address (see standing.service.ts). Registered inside a
 * `requireMerchant` scope.
 *
 * GET never creates anything: it reports the address if there is one, and null
 * if not, so a dashboard page load has no side effect. POST creates it on the
 * first call and returns the same address on every call after.
 */
export function depositRoutes(app: FastifyInstance, deps: StandingDeps & { catalogue: ChainCatalogueReader }) {
  app.get("/v1/deposit-address", async (req) => {
    const merchant = merchantOf(req);
    const standing = await findStanding(deps.db, merchant);
    return standing ? toDepositAddress(standing, merchant, await deps.catalogue.minimums()) : null;
  });

  app.post("/v1/deposit-address", async (req, reply) => {
    const merchant = merchantOf(req);
    const existed = (await findStanding(deps.db, merchant)) !== null;
    const standing = await ensureStanding(deps, merchant);
    return reply.code(existed ? 200 : 201).send(toDepositAddress(standing, merchant, await deps.catalogue.minimums()));
  });
}
