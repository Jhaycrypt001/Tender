import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import type { Redis } from "ioredis";
import type { Db } from "../db/client.js";
import { resolvePaymentManually } from "../services/payment-resolve.service.js";
import { unauthorized } from "../lib/errors.js";
import { resolveGoogleMerchant } from "../services/merchant.service.js";
import { toMerchant } from "../services/serialize.js";
import { isPlatformKey } from "./auth.js";

export type InternalRouteDeps = {
  db: Db;
  platformKey?: string;
  welcomeEmail?: boolean;
  /** For the operator's manual resolve: the live stream and the poller's judging rules. */
  redis: Pick<Redis, "publish">;
  graceMinutes: number;
  toleranceBps: number;
};

/**
 * Routes only the dashboard's server may call, with the platform key. Not part
 * of the public contract: they are documented in docs/INTEGRATION.md §1.
 */
export function internalRoutes(app: FastifyInstance, deps: InternalRouteDeps) {
  app.post("/internal/merchants/resolve", async (req, reply) => {
    if (!isPlatformKey(req.headers.authorization, deps.platformKey)) throw unauthorized();
    const who = S.ResolveMerchantInput.parse(req.body);
    const { merchant, created } = await resolveGoogleMerchant(deps.db, {
      googleSub: who.google_sub,
      email: who.email,
      name: who.name?.trim() || who.email.split("@")[0]!,
    }, { welcomeEmail: deps.welcomeEmail });
    req.log.info({ merchantId: merchant.id, created, via: "platform" }, "resolved merchant for sign-in");
    return reply.code(created ? 201 : 200).send(toMerchant(merchant));
  });

  /**
   * Operator only: closes a payment Aurora resolved outside its deposit lists (a refund or delivery by its
   * support team). Needs the proof transaction and a reason. See payment-resolve.service.ts.
   */
  app.post("/internal/payments/:id/resolve", async (req) => {
    if (!isPlatformKey(req.headers.authorization, deps.platformKey)) throw unauthorized();
    const { id } = z.object({ id: z.string().min(1).max(64) }).parse(req.params);
    const body = S.ResolvePaymentInput.parse(req.body);
    const payment = await resolvePaymentManually(
      { db: deps.db, redis: deps.redis, logger: req.log, graceMinutes: deps.graceMinutes, toleranceBps: deps.toleranceBps },
      id,
      body,
    );
    return S.ResolvedPayment.parse({ id: payment.id, status: payment.status, invoice_id: payment.invoiceId });
  });
}
