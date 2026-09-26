import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import type { Merchant } from "../generated/prisma/client.js";
import { unauthorized } from "../lib/errors.js";
import { authenticate } from "../services/merchant.service.js";

declare module "fastify" {
  interface FastifyRequest {
    merchant?: Merchant;
  }
}

/**
 * `Authorization: Bearer <merchant_api_key>` on every route registered inside
 * the scope this is applied to. Unauthenticated requests never reach a handler.
 */
export function requireMerchant(app: FastifyInstance, db: Db) {
  app.addHook("preHandler", async (req) => {
    const header = req.headers.authorization ?? "";
    const [scheme, key] = header.split(" ");
    if (scheme !== "Bearer" || !key) throw unauthorized();
    const merchant = await authenticate(db, key);
    if (!merchant) throw unauthorized();
    req.merchant = merchant;
  });
}

/** The authenticated merchant. Only valid inside a `requireMerchant` scope. */
export function merchantOf(req: FastifyRequest): Merchant {
  if (!req.merchant) throw unauthorized();
  return req.merchant;
}
