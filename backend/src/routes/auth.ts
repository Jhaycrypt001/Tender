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
const REFUSAL_WINDOW_MS = 30_000;
/** When each caller's last refusal line was written, and how many refusals since were folded into the next one. */
const refusals = new Map<string, { at: number; suppressed: number }>();

export function requireMerchant(app: FastifyInstance, db: Db, platformKey?: string) {
  app.addHook("preHandler", async (req) => {
    // Why a request was refused is logged, never what it carried: at most the first 12 characters of a key,
    // which is its type and a few random characters, far too little to use.
    // A scanner can send hundreds a minute, so it is one line per caller and reason every 30s, carrying how many
    // refusals it stands for. Nothing is lost: `count` says how many.
    const deny = (reason: string, key?: string) => {
      const slot = `${req.ip}|${reason}`;
      const now = Date.now();
      const seen = refusals.get(slot);
      if (seen && now - seen.at < REFUSAL_WINDOW_MS) {
        seen.suppressed += 1;
        return unauthorized();
      }
      refusals.set(slot, { at: now, suppressed: 0 });
      if (refusals.size > 5_000) for (const [k, v] of refusals) if (now - v.at > REFUSAL_WINDOW_MS) refusals.delete(k);
      req.log.warn(
        { reason, ip: req.ip, method: req.method, path: req.url.split("?")[0], keyPrefix: key ? key.slice(0, 12) : null, count: 1 + (seen?.suppressed ?? 0) },
        "authentication refused",
      );
      return unauthorized();
    };
    const header = req.headers.authorization ?? "";
    const [scheme, key] = header.split(" ");
    if (scheme !== "Bearer" || !key) throw deny(header ? "malformed authorization header" : "no authorization header");

    if (key.startsWith(PLATFORM_KEY_PREFIX)) {
      if (!isPlatformKey(header, platformKey)) throw deny("platform key did not match", key);
      const id = req.headers[MERCHANT_HEADER];
      if (typeof id !== "string" || !id) throw deny("platform call without a merchant id", key);
      const merchant = await db.merchant.findUnique({ where: { id } });
      if (!merchant) throw deny("platform call for an unknown merchant", key);
      req.log.debug({ merchantId: merchant.id, via: "platform" }, "platform call acting for merchant");
      req.merchant = merchant;
      return;
    }

    const merchant = await authenticate(db, key);
    if (!merchant) throw deny("API key unknown, revoked or wrong", key);
    req.merchant = merchant;
  });
}

/** The authenticated merchant. Only valid inside a `requireMerchant` scope. */
export function merchantOf(req: FastifyRequest): Merchant {
  if (!req.merchant) throw unauthorized();
  return req.merchant;
}
