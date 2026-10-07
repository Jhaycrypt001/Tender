import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import {
  getPayment,
  listPayments,
  refundPayment,
  retryPayment,
  toPaymentDetail,
  withdrawPayment,
} from "../services/payment.service.js";
import { toPayment } from "../services/serialize.js";
import { refundedByPayment } from "../services/transfer.service.js";
import { merchantOf } from "./auth.js";

const IdParams = z.object({ id: z.string().min(1).max(64) });
const WithdrawBody = z.object({ address: z.string().optional() }).optional();

/** Payment routes, including the NEEDS_RECOVERY actions. Registered inside a `requireMerchant` scope. */
export function paymentRoutes(app: FastifyInstance, deps: { db: Db }) {
  app.get("/v1/payments", async (req) => {
    const query = S.ListPaymentsQuery.parse(req.query);
    const { page, hasMore, nextCursor } = await listPayments(deps.db, merchantOf(req).id, query);
    const refunded = await refundedByPayment(deps.db, page.map((p) => p.id));
    return { data: page.map((p) => toPayment(p, refunded.get(p.id), p.invoice)), has_more: hasMore, next_cursor: nextCursor };
  });

  app.get("/v1/payments/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const payment = await getPayment(deps.db, merchantOf(req).id, id);
    return toPaymentDetail(payment, (await refundedByPayment(deps.db, [payment.id])).get(payment.id));
  });

  app.post("/v1/payments/:id/retry", async (req) => {
    const { id } = IdParams.parse(req.params);
    return toPaymentDetail(await retryPayment(deps.db, merchantOf(req).id, id));
  });

  app.post("/v1/payments/:id/withdraw", async (req) => {
    const { id } = IdParams.parse(req.params);
    const body = WithdrawBody.parse(req.body ?? undefined);
    return toPaymentDetail(await withdrawPayment(deps.db, merchantOf(req), id, body?.address));
  });

  app.post("/v1/payments/:id/refund", async (req) => {
    const { id } = IdParams.parse(req.params);
    await getPayment(deps.db, merchantOf(req).id, id); // 404 before 501
    refundPayment();
  });
}
