import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuroraClient } from "../aurora/client.js";
import type { Db } from "../db/client.js";
import { getPublicInvoice } from "../services/invoice.service.js";
import { getPublicLink, openLink } from "../services/link.service.js";
import { describeEta, type ChainCatalogueReader } from "../services/chains.service.js";
import { effectiveStatus, toPublicInvoice } from "../services/serialize.js";
import type { InvoiceStream } from "../services/stream.js";

const TokenParams = z.object({ token: z.string().max(64) });
const SubmitTxBody = z.object({ tx_hash: z.string().trim().min(8).max(200).regex(/^[0-9A-Za-z]+$/, "must be a transaction hash") });

/** States the buyer can no longer change; the stream closes on them. */
const OPEN_STATUSES = new Set(["PENDING", "DETECTED"]);

const HEARTBEAT_MS = 15_000;

export type PublicDeps = {
  db: Db;
  aurora: Pick<AuroraClient, "submitDeposit" | "mintAddress">;
  ttlMinutes: number;
  stream: InvoiceStream;
  catalogue: ChainCatalogueReader;
};

/**
 * Unauthenticated routes the buyer's checkout page calls from the browser.
 *
 * Every invoice response here is built by `toPublicInvoice`, field by field:
 * no merchant email, no settlement address, no internal id, no other invoice.
 */
export function publicRoutes(app: FastifyInstance, deps: PublicDeps) {
  app.get("/public/invoices/:token", async (req, reply) => {
    const { token } = TokenParams.parse(req.params);
    const invoice = await getPublicInvoice(deps.db, token);
    // Status changes by the second; never let a proxy or browser cache it.
    reply.header("cache-control", "no-store");
    return toPublicInvoice(invoice, invoice.merchant, await deps.catalogue.minimums());
  });

  /**
   * Supported chains with their measured minimum (USD) and settlement time.
   * 503 until the worker has measured them: a minimum is never guessed.
   */
  app.get("/public/chains", async (_req, reply) => {
    const catalogue = await deps.catalogue.get();
    if (!catalogue || catalogue.chains.length === 0) {
      return reply.code(503).send({ error: "not_ready", message: "Chain minimums have not been measured yet. Try again shortly." });
    }
    reply.header("cache-control", "public, max-age=60");
    return catalogue.chains.map((c) => ({
      id: c.id,
      name: c.name,
      asset: c.asset,
      minimum: c.minimum,
      estimated_settlement: describeEta(c.etaSeconds),
    }));
  });

  /**
   * Server-sent events: one `data:` frame per status change, carrying an
   * InvoiceEvent. The current status is always sent first, so a client that
   * reconnects can never miss where things stand. The stream ends once the
   * invoice reaches a state the buyer cannot change.
   */
  app.get("/public/invoices/:token/events", async (req, reply) => {
    const { token } = TokenParams.parse(req.params);
    await getPublicInvoice(deps.db, token); // 404s before we commit to a stream

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>), // keeps the CORS headers
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });

    let closed = false;
    const send = (data: unknown) => {
      if (!closed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const heartbeat = setInterval(() => !closed && res.write(": ping\n\n"), HEARTBEAT_MS);
    let unsubscribe: (() => Promise<void>) | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      void unsubscribe?.();
      res.end();
    };
    req.raw.on("close", close);

    // Subscribe BEFORE reading the current status: a change landing between
    // the two is then delivered twice at worst, never lost.
    unsubscribe = await deps.stream.subscribe(token, (event) => {
      send(event);
      if (!OPEN_STATUSES.has(event.status)) close();
    });
    if (closed) return void unsubscribe();

    const invoice = await getPublicInvoice(deps.db, token);
    const status = effectiveStatus(invoice);
    send({ status, at: new Date().toISOString() });
    if (!OPEN_STATUSES.has(status)) close();
  });

  /**
   * What a buyer sees before opening a payment link: who they are paying and
   * how much. Creates nothing and is not counted as a use, so chat apps that
   * fetch links to draw a preview are harmless. Additive, optional to use.
   */
  app.get("/public/links/:token", async (req) => {
    const { token } = TokenParams.parse(req.params);
    return getPublicLink(deps.db, token);
  });

  /**
   * A buyer opens a reusable payment link: we create their own invoice and
   * return its checkout token. Not yet in the published contract — additive.
   */
  app.post("/public/links/:token", async (req, reply) => {
    const { token } = TokenParams.parse(req.params);
    const body = z.object({ amount: z.string().optional() }).optional().parse(req.body ?? undefined);
    const invoice = await openLink({ db: deps.db, aurora: deps.aurora, ttlMinutes: deps.ttlMinutes }, token, body?.amount);
    return reply.code(201).send({ token: invoice.token });
  });

  /**
   * Optional accelerator: the buyer pastes the hash of their transfer and we
   * tell Aurora about it. We do not know which chain the hash is on, so it is
   * offered against each of the invoice's addresses; Aurora ignores the ones
   * it does not match. Best-effort by design — the poller finds the payment
   * regardless.
   */
  app.post("/public/invoices/:token/submit-tx", async (req) => {
    const { token } = TokenParams.parse(req.params);
    const { tx_hash } = SubmitTxBody.parse(req.body);
    const invoice = await getPublicInvoice(deps.db, token);
    if (!OPEN_STATUSES.has(effectiveStatus(invoice))) return { accepted: false };

    const results = await Promise.allSettled(invoice.addresses.map((a) => deps.aurora.submitDeposit(tx_hash, a.address)));
    // Poll this invoice on the next tick rather than waiting out the interval.
    await deps.db.invoiceAddress.updateMany({ where: { invoiceId: invoice.id }, data: { nextPollAt: new Date() } });
    return { accepted: results.some((r) => r.status === "fulfilled") };
  });
}
