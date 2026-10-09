import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import { getTransfer, listPayoutChains, listTransfers, prepareTransfer, quoteTransfer, submitTransfer, toTransfer, walletInfo, type TransferDeps } from "../services/transfer.service.js";
import { merchantOf } from "./auth.js";

const IdParams = z.object({ id: z.string().min(1).max(64) });
const ListQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).optional() });

export type TransferRouteDeps = Omit<TransferDeps, "db"> & { db: Db };

/**
 * Sending money out of the merchant's own wallet. Registered inside a
 * `requireMerchant` scope. See transfer.service.ts for how this stays
 * non-custodial: these routes plan and relay, and only the merchant's wallet
 * can authorize a transfer.
 */
export function transferRoutes(app: FastifyInstance, deps: TransferRouteDeps) {
  /** Whether the merchant can send, and what their wallet holds. */
  app.get("/v1/transfers/wallet", async (req) => walletInfo(deps, merchantOf(req)));

  /** The chains a payout or refund can be sent to, and what the recipient receives on each. */
  app.get("/v1/transfers/chains", async () => ({ data: await listPayoutChains(deps) }));

  /** Would Aurora take this, and roughly what would arrive? Moves and creates nothing. */
  app.post("/v1/transfers/quote", async (req) => quoteTransfer(deps, merchantOf(req), S.QuoteTransferBody.parse(req.body)));

  /** Step 1: validate and return what the wallet must sign. Moves nothing. */
  app.post("/v1/transfers", async (req, reply) => {
    const body = S.PrepareTransferBody.parse(req.body);
    const transfer = await prepareTransfer(deps, merchantOf(req), body);
    return reply.code(201).send(toTransfer(transfer, true));
  });

  /** Step 2: hand back the signatures; the relayer submits them. */
  app.post("/v1/transfers/:id/submit", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = S.SubmitTransferBody.parse(req.body);
    return toTransfer(await submitTransfer(deps, merchantOf(req), id, body.signatures));
  });

  app.get("/v1/transfers", async (req) => {
    const { limit } = ListQuery.parse(req.query);
    return { data: (await listTransfers(deps.db, merchantOf(req).id, limit)).map((t) => toTransfer(t)) };
  });

  app.get("/v1/transfers/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    return toTransfer(await getTransfer(deps.db, merchantOf(req).id, id));
  });
}
