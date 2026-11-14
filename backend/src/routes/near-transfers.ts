import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import { getNearTransfer, prepareNearTransfer, quoteNearTransfer, submitNearTransfer, type NearTransferDeps } from "../services/near-transfer.service.js";
import { toTransfer } from "../services/transfer.service.js";
import { merchantOf } from "./auth.js";

const IdParams = z.object({ id: z.string().min(1).max(64) });

/**
 * Paying out to a NEAR account through NEAR Intents, direct (see near-transfer.service.ts). Registered inside a
 * `requireMerchant` scope, next to the other transfer routes and additive to them.
 */
export function nearTransferRoutes(app: FastifyInstance, deps: NearTransferDeps) {
  /** Would NEAR Intents take this, and roughly what would arrive? Moves and creates nothing. */
  app.post("/v1/transfers/near-direct/quote", async (req) => quoteNearTransfer(deps, merchantOf(req), S.NearQuoteBody.parse(req.body)));

  /** Step 1: a deposit address from NEAR Intents, and what the wallet must sign. Moves nothing. */
  app.post("/v1/transfers/near-direct", async (req, reply) => {
    const transfer = await prepareNearTransfer(deps, merchantOf(req), S.NearTransferBody.parse(req.body));
    return reply.code(201).send(toTransfer(transfer, true));
  });

  /** Step 2: hand back the signatures; the relayer submits them. */
  app.post("/v1/transfers/near-direct/:id/submit", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = S.SubmitTransferBody.parse(req.body);
    return toTransfer(await submitNearTransfer(deps, merchantOf(req), id, body.signatures));
  });

  app.get("/v1/transfers/near-direct/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    return toTransfer(await getNearTransfer(deps.db, merchantOf(req).id, id));
  });
}
