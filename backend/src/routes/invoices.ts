import type { FastifyInstance } from "fastify";
import { z } from "zod";
import * as S from "../../contract/schemas.js";
import {
  cancelInvoice,
  createInvoice,
  getInvoice,
  listInvoices,
  type InvoiceDeps,
} from "../services/invoice.service.js";
import { toInvoice, toPayment } from "../services/serialize.js";
import type { ChainCatalogueReader } from "../services/chains.service.js";
import { merchantOf } from "./auth.js";

const IdParams = z.object({ id: z.string().min(1).max(64) });

/** Merchant invoice routes. Registered inside a `requireMerchant` scope. */
export function invoiceRoutes(app: FastifyInstance, deps: InvoiceDeps & { catalogue: ChainCatalogueReader }) {
  app.post("/v1/invoices", async (req, reply) => {
    const input = S.CreateInvoiceInput.parse(req.body);
    const { invoice, created } = await createInvoice(deps, merchantOf(req), input);
    return reply.code(created ? 201 : 200).send(toInvoice(invoice, await deps.catalogue.minimums()));
  });

  app.get("/v1/invoices", async (req) => {
    const query = S.ListInvoicesQuery.parse(req.query);
    const { page, hasMore, nextCursor } = await listInvoices(deps.db, merchantOf(req).id, query);
    const minimums = await deps.catalogue.minimums();
    return { data: page.map((i) => toInvoice(i, minimums)), has_more: hasMore, next_cursor: nextCursor };
  });

  app.get("/v1/invoices/:id", async (req) => {
    const { id } = IdParams.parse(req.params);
    const invoice = await getInvoice(deps.db, merchantOf(req).id, id);
    return { ...toInvoice(invoice, await deps.catalogue.minimums()), payments: invoice.payments.map((p) => toPayment(p, undefined, invoice)) };
  });

  app.post("/v1/invoices/:id/cancel", async (req) => {
    const { id } = IdParams.parse(req.params);
    return toInvoice(await cancelInvoice(deps.db, merchantOf(req).id, id), await deps.catalogue.minimums());
  });
}
