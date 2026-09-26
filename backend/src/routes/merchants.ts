import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import { conflict, validation } from "../lib/errors.js";
import { eventId } from "../lib/ids.js";
import { assertSafeWebhookUrl, UnsafeDestinationError } from "../lib/safe-http.js";
import { SETTLEMENT_ASSETS, updateMerchant } from "../services/merchant.service.js";
import { toMerchant } from "../services/serialize.js";
import { issueChallenge, verifyChallenge } from "../services/settlement-proof.service.js";
import { sendWebhook } from "../services/webhook.service.js";
import { merchantOf } from "./auth.js";

const VerifyBody = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "must be a 0x-prefixed hex signature") });

export type MerchantRouteDeps = { db: Db; redis: Redis };

/** Merchant profile, settings and settlement proof. Registered inside a `requireMerchant` scope. */
export function merchantRoutes(app: FastifyInstance, deps: MerchantRouteDeps) {
  app.get("/v1/merchant", async (req) => toMerchant(merchantOf(req)));

  app.patch("/v1/merchant", async (req) => {
    const input = S.UpdateMerchantInput.parse(req.body);
    if (input.settlement_asset && !(SETTLEMENT_ASSETS as readonly string[]).includes(input.settlement_asset)) {
      throw validation({ settlement_asset: `must be one of ${SETTLEMENT_ASSETS.join(", ")}` });
    }
    if (input.webhook_url) {
      try {
        await assertSafeWebhookUrl(input.webhook_url);
      } catch (err) {
        if (err instanceof UnsafeDestinationError) throw validation({ webhook_url: err.message });
        throw err;
      }
    }
    return toMerchant(await updateMerchant(deps.db, merchantOf(req), input));
  });

  /** Sends a signed `webhook.test` event right now and reports what happened. */
  app.post("/v1/merchant/webhook/test", async (req) => {
    const merchant = merchantOf(req);
    if (!merchant.webhookUrl) throw conflict("Set a webhook_url first");
    const payload = {
      id: eventId(),
      event: "webhook.test",
      created_at: new Date().toISOString(),
      data: { merchant_id: merchant.id },
    };
    const result = await sendWebhook(merchant.webhookUrl, merchant.webhookSecret, payload);
    return result.ok
      ? { delivered: true, status_code: result.status, event_id: payload.id }
      : { delivered: false, status_code: result.status ?? null, error: result.error, event_id: payload.id };
  });

  app.post("/v1/merchant/settlement/challenge", async (req) => issueChallenge(deps.redis, merchantOf(req)));

  app.post("/v1/merchant/settlement/verify", async (req) => {
    const { signature } = VerifyBody.parse(req.body);
    const merchant = await verifyChallenge(deps, merchantOf(req), signature);
    return toMerchant(merchant);
  });
}

