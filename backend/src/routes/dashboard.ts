import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import { ApiError } from "../lib/errors.js";
import { balance } from "../services/balance.service.js";
import type { TransferChain } from "../services/transfer-chain.js";
import type { InvoiceDeps } from "../services/invoice.service.js";
import { createLink, listLinks, toLink } from "../services/link.service.js";
import type { RampService } from "../services/ramp.service.js";
import { listRampSales, toRampSale, webhookTokenFor } from "../services/ramp-sale.service.js";
import { merchantOf } from "./auth.js";

const Page = z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() });

/**
 * The remaining dashboard routes. Registered inside a `requireMerchant` scope.
 *
 * Ramps and Earn return what is TRUE today, not a demo: an off-ramp corridor is
 * LIVE only when Ramp confirms it, and no Earn position exists (see BACKEND.md §9 for Earn's status).
 */
export function dashboardRoutes(app: FastifyInstance, deps: InvoiceDeps & { wallet?: Pick<TransferChain, "tokenBalance">; ramp: RampService }) {
  app.get("/v1/merchant/balance", async (req) => balance(deps.db, merchantOf(req), deps.wallet));

  app.get("/v1/links", async (req) => {
    const { cursor, limit } = Page.parse(req.query);
    const { page, hasMore, nextCursor } = await listLinks(deps.db, merchantOf(req).id, cursor, limit);
    return { data: page.map(toLink), has_more: hasMore, next_cursor: nextCursor };
  });

  app.post("/v1/links", async (req, reply) => {
    const input = S.CreateLinkInput.parse(req.body);
    const merchantId = merchantOf(req).id;
    const link = await createLink(deps.db, merchantId, input);
    req.log.info({ linkId: link.id, merchantId, amount: link.amount ? String(link.amount) : null, currency: link.currency }, "payment link created");
    return reply.code(201).send(toLink(link));
  });

  // A corridor is LIVE only when Ramp says it can buy THIS merchant's settlement token for that currency right now.
  // Any failure reads as NOT_OPEN (see ramp.service.ts). `daily_cap` stays absent: Ramp's limit is per sale.
  app.get("/v1/ramps/corridors", async (req) => deps.ramp.corridors(merchantOf(req).settlementAsset));

  // What the Cash out button passes to Ramp's widget as `offrampWebhookV3Url`, after the API's own base URL.
  // The token, not the merchant id, is what names the merchant: see merchantForWebhookToken.
  app.get("/v1/ramps/widget", async (req) => {
    const token = await webhookTokenFor(deps.db, merchantOf(req).id);
    return { webhook_path: `/webhooks/ramp?t=${token}` };
  });

  // Cash-outs Ramp has told us about. Money OUT: the dashboard lists these beside payouts, never among payments received.
  app.get("/v1/ramps/sales", async (req) => {
    const { cursor, limit } = Page.parse(req.query);
    const { page, hasMore, nextCursor } = await listRampSales(deps.db, merchantOf(req).id, cursor, limit);
    return { data: page.map(toRampSale), has_more: hasMore, next_cursor: nextCursor };
  });

  app.get("/v1/earn/positions", async () => []);

  app.post("/v1/earn/deposit", async () => {
    throw new ApiError(
      501,
      "not_implemented",
      "Earn is not available yet. It routes settled revenue into a Monad position through Aurora Intents Connect, which is not integrated.",
    );
  });
}
