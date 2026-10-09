import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import { ApiError } from "../lib/errors.js";
import { balance } from "../services/balance.service.js";
import type { TransferChain } from "../services/transfer-chain.js";
import type { InvoiceDeps } from "../services/invoice.service.js";
import { createLink, listLinks, toLink } from "../services/link.service.js";
import { merchantOf } from "./auth.js";

const Page = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

/**
 * The remaining dashboard routes. Registered inside a `requireMerchant` scope.
 *
 * Ramps and Earn return what is TRUE today, not a demo: no off-ramp corridor
 * is live, and no Earn position exists (see BACKEND.md §9 for Earn's status).
 */
export function dashboardRoutes(app: FastifyInstance, deps: InvoiceDeps & { wallet?: Pick<TransferChain, "tokenBalance"> }) {
  app.get("/v1/merchant/balance", async (req) => balance(deps.db, merchantOf(req), deps.wallet));

  app.get("/v1/links", async (req) => {
    const { cursor, limit } = Page.parse(req.query);
    const { page, hasMore, nextCursor } = await listLinks(deps.db, merchantOf(req).id, cursor, limit);
    return { data: page.map(toLink), has_more: hasMore, next_cursor: nextCursor };
  });

  app.post("/v1/links", async (req, reply) => {
    const input = S.CreateLinkInput.parse(req.body);
    return reply.code(201).send(toLink(await createLink(deps.db, merchantOf(req).id, input)));
  });

  // No off-ramp partner is integrated, so no corridor is live — and we do not
  // list aspirational ones as if they were a roadmap commitment.
  app.get("/v1/ramps/corridors", async () => []);

  app.get("/v1/earn/positions", async () => []);

  app.post("/v1/earn/deposit", async () => {
    throw new ApiError(
      501,
      "not_implemented",
      "Earn is not available yet. It routes settled revenue into a Monad position through Aurora Intents Connect, which is not integrated.",
    );
  });
}
