import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "../db/client.js";
import type { Merchant } from "../generated/prisma/client.js";
import { safeEqual } from "../lib/crypto.js";
import { unauthorized } from "../lib/errors.js";
import { authenticate } from "../services/merchant.service.js";

declare module "fastify" {
  interface FastifyRequest {
    merchant?: Merchant;
  }
}

export const PLATFORM_KEY_PREFIX = "tp_";
export const MERCHANT_HEADER = "x-tender-merchant";

/** True when `Authorization: Bearer <platform key>` matches the configured key, in constant time. */
export function isPlatformKey(header: string | undefined, platformKey: string | undefined): boolean {
  if (!platformKey) return false;
  const [scheme, key] = (header ?? "").split(" ");
  return scheme === "Bearer" && !!key && key.startsWith(PLATFORM_KEY_PREFIX) && safeEqual(key, platformKey);
}

/**
 * Two ways in, on every route registered inside the scope this is applied to:
 *
 *  - `Authorization: Bearer tk_live_…`: a merchant's own server.
 *  - `Authorization: Bearer tp_…` plus `X-Tender-Merchant: mer_…`: the
 *    dashboard's server, acting for the merchant a signed-in user maps to.
 *
 * Unauthenticated requests never reach a handler. A platform call with a
 * missing or unknown merchant id is a 401, not a 404, so the header cannot be
 * used to probe which merchant ids exist.
 */
export function requireMerchant(app: FastifyInstance, db: Db, platformKey?: string) {
  app.addHook("preHandler", async (req) => {
    const header = req.headers.authorization ?? "";
    const [scheme, key] = header.split(" ");
    if (scheme !== "Bearer" || !key) throw unauthorized();

    if (key.startsWith(PLATFORM_KEY_PREFIX)) {
      if (!isPlatformKey(header, platformKey)) throw unauthorized();
      const id = req.headers[MERCHANT_HEADER];
      if (typeof id !== "string" || !id) throw unauthorized();
      const merchant = await db.merchant.findUnique({ where: { id } });
      if (!merchant) throw unauthorized();
      req.log.info({ merchantId: merchant.id, via: "platform" }, "platform call acting for merchant");
      req.merchant = merchant;
      return;
    }

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
