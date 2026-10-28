import type { KeyObject } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client.js";
import { verifyRampSignature } from "../lib/ramp-signature.js";
import { applyRampEvent, isKnownStatus, merchantForWebhookToken, RampEvent } from "../services/ramp-sale.service.js";

/**
 * POST /webhooks/ramp — Ramp Network tells us a cash-out changed state.
 *
 * ⚠️ This endpoint never mints a deposit address and never moves funds. It verifies, then records.
 *
 * Order matters:
 *   1. Verify Ramp's signature over the body. Nothing in an unverified body is read, trusted or logged.
 *   2. Parse it. A signed event we cannot parse is a LOUD 400 (Ramp's retries will not fix it, but the
 *      error line names the event so someone does).
 *   3. Work out the merchant from `?t=`, the merchant's webhook token (see `merchantForWebhookToken`).
 *      Query parameters are not signed, so the token is only looked up: an unknown one keeps the sale
 *      unattributed instead of dropping it.
 *   4. Record, idempotently.
 *
 * Answers 204 only once the sale is stored. Ramp retries four times, three minutes apart, then stops, so
 * a 2xx we did not earn would lose the sale for good.
 */
const Query = z.object({ t: z.string().optional() });

/** Anyone can POST here, so a rejected request is logged at most once per caller every 30s: a flood is a few lines. */
const REJECT_LOG_EVERY_MS = 30_000;

export function rampWebhookRoutes(app: FastifyInstance, deps: { db: Db; publicKey: KeyObject }) {
  const rejectedAt = new Map<string, number>();
  const logRejected = (ip: string, hasSignature: boolean, log: { warn: (o: object, m: string) => void }) => {
    const now = Date.now();
    if (now - (rejectedAt.get(ip) ?? 0) < REJECT_LOG_EVERY_MS) return;
    rejectedAt.set(ip, now);
    if (rejectedAt.size > 5_000) for (const [k, at] of rejectedAt) if (now - at > 60_000) rejectedAt.delete(k);
    log.warn({ ip, hasSignature }, "ramp webhook rejected: bad or missing signature (repeats from this caller muted for 30s)");
  };

  app.post("/webhooks/ramp", async (req, reply) => {
    const signature = req.headers["x-body-signature"];
    if (typeof signature !== "string" || !verifyRampSignature(req.body, signature, deps.publicKey)) {
      logRejected(req.ip, typeof signature === "string", req.log);
      return reply.code(401).send({ error: "unauthorized", message: "Invalid signature" });
    }

    const parsed = RampEvent.safeParse(req.body);
    if (!parsed.success) {
      const id = (req.body as { id?: unknown }).id;
      req.log.error({ eventId: typeof id === "string" ? id : null, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) }, "signed ramp webhook could not be read");
      return reply.code(400).send({ error: "validation", message: "Unreadable event" });
    }
    const event = parsed.data;

    // Signed and readable, but not something we record. Acknowledged so Ramp does not retry it.
    if (event.mode !== "OFFRAMP" || !isKnownStatus(event.type)) {
      req.log.warn({ eventId: event.id, mode: event.mode, type: event.type }, "ramp webhook ignored: not an off-ramp event we record");
      return reply.code(204).send();
    }

    const { t } = Query.parse(req.query);
    const merchantId = await merchantForWebhookToken(deps.db, t);
    if (!merchantId) {
      req.log.error({ eventId: event.id, saleId: event.payload.id }, "ramp sale has no known merchant: stored unattributed, needs a manual look");
    }

    const outcome = await applyRampEvent(deps.db, event, event.type, merchantId);
    req.log.info({ eventId: event.id, saleId: event.payload.id, type: event.type, outcome, merchantId }, "ramp webhook recorded");
    return reply.code(204).send();
  });
}
