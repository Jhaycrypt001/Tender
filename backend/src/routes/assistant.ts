import type { FastifyInstance } from "fastify";
import * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import { ask } from "../services/assistant.service.js";
import { merchantOf } from "./auth.js";

export type AssistantRouteDeps = { db: Db; apiKey: string; model: string; fallbackModel?: string; fetchImpl?: typeof fetch };

/**
 * POST /v1/assistant/ask. Registered inside the requireMerchant scope, and only
 * when GEMINI_API_KEY is set: no key means no route, a 404, and the dashboard
 * says honestly that the assistant is not connected. The merchant comes from
 * the authenticated request, never from the body.
 */
export function assistantRoutes(app: FastifyInstance, deps: AssistantRouteDeps) {
  app.post("/v1/assistant/ask", async (req) => {
    const { question } = S.AskInput.parse(req.body);
    return ask({ ...deps, merchant: merchantOf(req), logger: req.log }, question);
  });
}
