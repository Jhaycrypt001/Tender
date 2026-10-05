import { z } from "zod";
import * as S from "../contract/schemas.js";

/**
 * The OpenAPI document behind Swagger UI (`/docs`).
 *
 * Every schema here is generated from the SAME zod schemas the routes parse
 * with (`contract/schemas.ts`), which are themselves checked against the
 * frontend's types. So what Swagger shows is what the API actually accepts
 * and returns — it cannot drift. `test/openapi.test.ts` also fails if a route
 * exists that this document does not describe, or the other way round.
 */

type Schema = z.ZodType;

const json = (schema: Schema, io: "input" | "output" = "output") =>
  z.toJSONSchema(schema, { io, unrepresentable: "any" }) as Record<string, unknown>;

/* Shapes that are not part of the frontend contract, but are real responses. */
const Health = z.object({ status: z.enum(["ok", "degraded"]), database: z.enum(["ok", "down"]), redis: z.enum(["ok", "down"]) });
const SubmitTxBody = z.object({ tx_hash: z.string().describe("The transfer's transaction hash") });
const SubmitTxResult = z.object({ accepted: z.boolean() });
const OpenLinkBody = z.object({ amount: z.string().optional().describe('Only for open-amount links, e.g. "5.00"') });
const OpenLinkResult = z.object({ token: z.string().describe("chk_ token: redirect the buyer to its checkout") });
const VerifyBody = z.object({ signature: z.string().describe("EIP-191 signature of the challenge message, by the settlement wallet") });
const WithdrawBody = z.object({ address: z.string().optional().describe("EVM address; defaults to the settlement address") });
const WebhookTestResult = z.object({
  delivered: z.boolean(),
  status_code: z.number().nullable(),
  error: z.string().optional(),
  event_id: z.string(),
});

type Op = {
  summary: string;
  description?: string;
  tag: string;
  auth: boolean;
  /** Called with the dashboard's platform key (`tp_…`), not a merchant key. */
  platform?: boolean;
  params?: string[];
  query?: Schema;
  body?: Schema;
  ok: { status: number; schema?: Schema; description?: string; contentType?: string };
  errors?: number[];
};

const ERROR_TEXT: Record<number, string> = {
  400: "Validation failed — `fields` names each bad field",
  401: "Missing or invalid API key",
  404: "Not found (or not yours)",
  409: "Conflict with the current state",
  429: "Rate limited",
  501: "Not supported — see `message`",
  502: "Aurora could not be reached; nothing was written, retry",
  503: "Not ready yet (or, on the assistant, the model is unavailable)",
  504: "Took too long",
};

function operation(op: Op) {
  const parameters = [
    ...(op.params ?? []).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
    ...(op.query ? queryParameters(op.query) : []),
  ];
  const errors = [...new Set([...(op.auth || op.platform ? [401] : []), ...(op.errors ?? []), 429])];
  return {
    tags: [op.tag],
    summary: op.summary,
    ...(op.description ? { description: op.description } : {}),
    security: op.platform ? [{ platformKey: [] }] : op.auth ? [{ merchantKey: [] }, { platformKey: [] }] : [],
    ...(parameters.length ? { parameters } : {}),
    ...(op.body ? { requestBody: { required: true, content: { "application/json": { schema: json(op.body, "input") } } } } : {}),
    responses: {
      [op.ok.status]: {
        description: op.ok.description ?? "OK",
        ...(op.ok.schema
          ? { content: { [op.ok.contentType ?? "application/json"]: { schema: json(op.ok.schema) } } }
          : op.ok.contentType
            ? { content: { [op.ok.contentType]: { schema: { type: "string" } } } }
            : {}),
      },
      ...Object.fromEntries(
        errors.map((code) => [code, { description: ERROR_TEXT[code] ?? "Error", content: { "application/json": { schema: json(S.ErrorBody) } } }]),
      ),
    },
  };
}

function queryParameters(schema: Schema) {
  const shape = json(schema, "input") as { properties?: Record<string, unknown> };
  return Object.entries(shape.properties ?? {}).map(([name, s]) => ({ name, in: "query", required: false, schema: s }));
}

/** Route table: `METHOD /fastify/:path` → operation. */
export const OPERATIONS: Record<string, Op> = {
  "GET /health": {
    tag: "System",
    auth: false,
    summary: "Liveness and readiness",
    ok: { status: 200, schema: Health },
    errors: [503],
  },
  "GET /metrics": {
    tag: "System",
    auth: false,
    summary: "Prometheus metrics",
    description: "Requires `Authorization: Bearer <METRICS_TOKEN>` when METRICS_TOKEN is set.",
    ok: { status: 200, contentType: "text/plain" },
  },

  /* Public — the buyer checkout ------------------------------------------ */
  "GET /public/invoices/:token": {
    tag: "Public (checkout)",
    auth: false,
    summary: "An invoice, as the buyer may see it",
    description: "No merchant email, settlement address, internal id or reference. `minimum` is in USD.",
    params: ["token"],
    ok: { status: 200, schema: S.PublicInvoice },
    errors: [404],
  },
  "GET /public/invoices/:token/events": {
    tag: "Public (checkout)",
    auth: false,
    summary: "Live status (server-sent events)",
    description:
      "One `data:` frame per status change, each an InvoiceEvent. The current status is sent first; the stream closes on a terminal status. Swagger UI cannot display a stream — try it with `curl -N`.",
    params: ["token"],
    ok: { status: 200, contentType: "text/event-stream", description: "An SSE stream of InvoiceEvent frames" },
    errors: [404],
  },
  "POST /public/invoices/:token/submit-tx": {
    tag: "Public (checkout)",
    auth: false,
    summary: "Buyer submits their tx hash to speed up detection",
    params: ["token"],
    body: SubmitTxBody,
    ok: { status: 200, schema: SubmitTxResult },
    errors: [400, 404],
  },
  "GET /public/chains": {
    tag: "Public (checkout)",
    auth: false,
    summary: "Supported chains with measured minimums (USD) and settlement time",
    description: "503 until the worker has measured minimums — a minimum is never guessed.",
    ok: { status: 200, schema: z.array(S.Chain) },
    errors: [503],
  },
  "GET /public/links/:token": {
    tag: "Public (checkout)",
    auth: false,
    summary: "A payment link, as the buyer may see it before opening it",
    description:
      "Who is being paid, for what and how much (`amount` is null for open-amount links). Creates nothing and does not count as a use. " +
      "An inactive link returns 200 with `active: false`; a malformed or unknown token is 404.",
    params: ["token"],
    ok: { status: 200, schema: S.PublicLink },
    errors: [404],
  },
  "POST /public/links/:token": {
    tag: "Public (checkout)",
    auth: false,
    summary: "A buyer opens a payment link: creates their invoice",
    params: ["token"],
    body: OpenLinkBody,
    ok: { status: 201, schema: OpenLinkResult },
    errors: [400, 404, 409, 502],
  },

  /* Dashboard server only ------------------------------------------------ */
  "POST /internal/merchants/resolve": {
    tag: "Internal (dashboard server)",
    auth: false,
    platform: true,
    summary: "Find or create the merchant for a Google sign-in",
    description:
      "Called by the dashboard's server with `Authorization: Bearer <TENDER_PLATFORM_KEY>`. Upserts on `google_sub`, never on email. " +
      "201 when the merchant was just created, 200 when it already existed. A new merchant cannot take payments until it verifies a settlement address.",
    body: S.ResolveMerchantInput,
    ok: { status: 200, schema: S.Merchant, description: "Existing merchant (201 when newly created)" },
  },

  /* Merchant — invoices -------------------------------------------------- */
  "POST /v1/invoices": {
    tag: "Invoices",
    auth: true,
    summary: "Create an invoice and mint its deposit addresses",
    description: "Idempotent on `reference`: a retry returns the original invoice (200). 201 when newly created.",
    body: S.CreateInvoiceInput,
    ok: { status: 201, schema: S.Invoice },
    errors: [400, 409, 502],
  },
  "GET /v1/invoices": {
    tag: "Invoices",
    auth: true,
    summary: "List invoices, newest first",
    query: S.ListInvoicesQuery,
    ok: { status: 200, schema: S.paginated(S.Invoice) },
    errors: [400],
  },
  "GET /v1/invoices/:id": {
    tag: "Invoices",
    auth: true,
    summary: "One invoice, with its payments",
    params: ["id"],
    ok: { status: 200, schema: S.Invoice },
    errors: [404],
  },
  "POST /v1/invoices/:id/cancel": {
    tag: "Invoices",
    auth: true,
    summary: "Cancel a pending invoice",
    params: ["id"],
    ok: { status: 200, schema: S.Invoice },
    errors: [404, 409],
  },

  /* Merchant — payments & recovery -------------------------------------- */
  "GET /v1/payments": {
    tag: "Payments",
    auth: true,
    summary: "List payments across invoices",
    query: S.ListPaymentsQuery,
    ok: { status: 200, schema: S.paginated(S.Payment) },
    errors: [400],
  },
  "GET /v1/payments/:id": {
    tag: "Payments",
    auth: true,
    summary: "One payment, with history and any recovery task",
    params: ["id"],
    ok: { status: 200, schema: S.PaymentDetail },
    errors: [404],
  },
  "POST /v1/payments/:id/retry": {
    tag: "Payments",
    auth: true,
    summary: "NEEDS_RECOVERY: re-check Aurora for the payout",
    description: "Aurora has no retry API for persistent addresses; this re-checks now and keeps watching.",
    params: ["id"],
    ok: { status: 200, schema: S.PaymentDetail },
    errors: [404, 409],
  },
  "POST /v1/payments/:id/withdraw": {
    tag: "Payments",
    auth: true,
    summary: "NEEDS_RECOVERY: request a withdrawal (attaches an Aurora support case)",
    description: "Does NOT move funds — Aurora has no withdrawal API. The task stays OPEN; see `recovery.notes`.",
    params: ["id"],
    body: WithdrawBody,
    ok: { status: 200, schema: S.PaymentDetail },
    errors: [400, 404, 409],
  },
  "POST /v1/payments/:id/refund": {
    tag: "Payments",
    auth: true,
    summary: "Refund (not supported)",
    params: ["id"],
    ok: { status: 501, description: "Always 501: persistent addresses have no refund API" },
    errors: [404],
  },

  /* Merchant — account --------------------------------------------------- */
  "GET /v1/merchant": { tag: "Merchant", auth: true, summary: "The authenticated merchant", ok: { status: 200, schema: S.Merchant } },
  "PATCH /v1/merchant": {
    tag: "Merchant",
    auth: true,
    summary: "Update settlement address/asset or webhook URL",
    description: "Changing the settlement address clears `settlement_verified` until it is proven again.",
    body: S.UpdateMerchantInput,
    ok: { status: 200, schema: S.Merchant },
    errors: [400],
  },
  "POST /v1/assistant/ask": {
    tag: "Merchant",
    auth: true,
    summary: "Ask the assistant a question about your payments",
    description:
      "Answers in markdown limited to bold, inline code and `- ` lists. Read-only: it can look at this merchant's payments, invoices and balance, never act. " +
      "Limited to 10 per minute. Returns 404 when the server has no `GEMINI_API_KEY`, 504 if the model takes longer than 12 s.",
    body: S.AskInput,
    ok: { status: 200, schema: S.AskAnswer },
    errors: [400, 503, 504],
  },
  "GET /v1/merchant/api-keys": {
    tag: "Merchant",
    auth: true,
    summary: "List active API keys (prefix only)",
    ok: { status: 200, schema: S.ApiKeyList },
  },
  "POST /v1/merchant/api-keys": {
    tag: "Merchant",
    auth: true,
    summary: "Issue an API key",
    description: "The `key` is returned ONCE. A merchant may hold up to 10 active keys, so rotating is: create, deploy, revoke the old one.",
    ok: { status: 201, schema: S.CreatedApiKey },
    errors: [409],
  },
  "DELETE /v1/merchant/api-keys/:id": {
    tag: "Merchant",
    auth: true,
    summary: "Revoke an API key",
    description: "Takes effect immediately. 404 if the key is not this merchant's.",
    params: ["id"],
    ok: { status: 204, description: "Revoked" },
    errors: [404],
  },
  "GET /v1/merchant/webhook/deliveries": {
    tag: "Merchant",
    auth: true,
    summary: "Recent webhook deliveries",
    description:
      "Newest first. `status`: `delivered`, `retrying` (attempts left), or `failed` (every retry used; it will not be sent again). " +
      "Use `?status=failed` to find the events your server never received.",
    query: S.ListWebhookDeliveriesQuery,
    ok: { status: 200, schema: S.WebhookDeliveryList },
    errors: [400],
  },
  "POST /v1/merchant/webhook/secret": {
    tag: "Merchant",
    auth: true,
    summary: "Rotate the webhook signing secret",
    description: "The new secret is returned ONCE and replaces the old one immediately; update your verifier first or deliveries will fail verification.",
    ok: { status: 201, schema: S.RotatedWebhookSecret },
  },
  "POST /v1/merchant/webhook/test": {
    tag: "Merchant",
    auth: true,
    summary: "Send a signed webhook.test event now",
    ok: { status: 200, schema: WebhookTestResult },
    errors: [409],
  },
  "POST /v1/merchant/settlement/challenge": {
    tag: "Merchant",
    auth: true,
    summary: "Get a message to sign with the settlement wallet",
    ok: { status: 200, schema: S.SettlementChallenge },
    errors: [409],
  },
  "POST /v1/merchant/settlement/verify": {
    tag: "Merchant",
    auth: true,
    summary: "Submit the signature; verifies the settlement address",
    body: VerifyBody,
    ok: { status: 200, schema: S.Merchant },
    errors: [400],
  },
  "GET /v1/merchant/balance": {
    tag: "Merchant",
    auth: true,
    summary: "Settled and in-flight totals",
    ok: { status: 200, schema: S.Balance },
  },

  /* Merchant — links, ramps, earn --------------------------------------- */
  "GET /v1/links": {
    tag: "Links",
    auth: true,
    summary: "List payment links",
    query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }),
    ok: { status: 200, schema: S.paginated(S.PaymentLink) },
  },
  "POST /v1/links": {
    tag: "Links",
    auth: true,
    summary: "Create a payment link",
    body: S.CreateLinkInput,
    ok: { status: 201, schema: S.PaymentLink },
    errors: [400],
  },
  "GET /v1/ramps/corridors": {
    tag: "Ramps & Earn",
    auth: true,
    summary: "Off-ramp corridors (none are live)",
    ok: { status: 200, schema: z.array(S.RampCorridor) },
  },
  "GET /v1/earn/positions": {
    tag: "Ramps & Earn",
    auth: true,
    summary: "Earn positions (none: Earn is not built)",
    ok: { status: 200, schema: z.array(S.EarnPosition) },
  },
  "POST /v1/earn/deposit": {
    tag: "Ramps & Earn",
    auth: true,
    summary: "Earn deposit (not implemented)",
    ok: { status: 501, description: "Always 501 until Intents Connect is integrated" },
  },
};

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [key, op] of Object.entries(OPERATIONS)) {
    const [method, route] = key.split(" ") as [string, string];
    const path = route.replace(/:(\w+)/g, "{$1}");
    (paths[path] ??= {})[method.toLowerCase()] = operation(op);
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Tender API",
      version: "0.1.0",
      description:
        "Any-chain crypto checkout. Buyers pay from any chain; merchants settle in one asset on Monad.\n\n" +
        "Merchant routes need **Authorize → `tk_live_…`** (create one with `npm run merchant:create`). " +
        "Public routes are what the buyer checkout calls. Money is always a decimal **string**; the wire is **snake_case**.",
    },
    components: {
      securitySchemes: {
        merchantKey: { type: "http", scheme: "bearer", description: "Merchant API key (tk_live_…)" },
        platformKey: {
          type: "http",
          scheme: "bearer",
          description: "Dashboard platform key (tp_…). On /v1 routes, also send `X-Tender-Merchant: mer_…`. Server-side only.",
        },
      },
    },
    tags: ["Invoices", "Payments", "Merchant", "Links", "Ramps & Earn", "Public (checkout)", "Internal (dashboard server)", "System"].map((name) => ({ name })),
    paths,
  };
}
