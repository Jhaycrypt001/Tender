import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import { unauthorized } from "../lib/errors.js";
import { resolveGoogleMerchant } from "../services/merchant.service.js";
import { toMerchant } from "../services/serialize.js";
import { isPlatformKey } from "./auth.js";

export type InternalRouteDeps = { db: Db; platformKey?: string; welcomeEmail?: boolean };

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
}
