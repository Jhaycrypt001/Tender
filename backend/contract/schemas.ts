import { z } from "zod";

/**
 * The Tender wire contract, as zod schemas.
 *
 * The contract itself is owned jointly and written down as TypeScript types in
 * `frontend/src/lib/api/types.ts`. These schemas are the backend's executable
 * copy: requests are parsed with them, and responses are shaped to them.
 *
 * `contract.check.ts` proves at compile time that every schema here matches
 * the frontend's type. If either side changes a shape alone, `npm run
 * typecheck` fails here — that is what stops the two halves drifting.
 *
 * Conventions (same as types.ts): snake_case on the wire, money as strings.
 */

/* -------------------------------------------------------------------------- */
/* Primitives                                                                  */
/* -------------------------------------------------------------------------- */

/** Non-negative base-10 decimal, up to 18 places. Never a number. */
export const Amount = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,18})?$/, "must be a decimal string, e.g. \"49.00\"");
export const Timestamp = z.string();
export const ChainId = z.string().min(1);

export const InvoiceStatus = z.enum([
  "PENDING",
  "DETECTED",
  "SETTLED",
  "OVERPAID",
  "UNDERPAID",
  "EXPIRED",
  "CANCELLED",
  "NEEDS_RECOVERY",
]);

export const PaymentStatus = z.enum(["DETECTED", "SETTLED", "FAILED", "REFUNDED"]);
export const RecoveryState = z.enum(["OPEN", "RETRYING", "WITHDRAWN", "RESOLVED", "FAILED"]);

/* -------------------------------------------------------------------------- */
/* Invoice                                                                     */
/* -------------------------------------------------------------------------- */

export const InvoiceAddress = z.object({
  chain: ChainId,
  address: z.string(),
  minimum: Amount.optional(),
});

export const Payment = z.object({
  id: z.string(),
  invoice_id: z.string(),
  tx_hash: z.string(),
  from_chain: ChainId,
  amount_in: Amount,
  amount_settled: Amount.nullish(),
  status: PaymentStatus,
  first_seen_at: Timestamp,
  settled_at: Timestamp.nullish(),
});

export const Invoice = z.object({
  id: z.string(),
  token: z.string(),
  status: InvoiceStatus,
  amount_expected: Amount,
  currency: z.string(),
  reference: z.string(),
  expires_at: Timestamp,
  created_at: Timestamp,
  redirect_url: z.string().nullish(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  addresses: z.array(InvoiceAddress),
  payments: z.array(Payment).optional(),
});

/** Body of POST /v1/invoices. */
export const CreateInvoiceInput = z.object({
  amount_expected: Amount.refine((s) => !/^0(\.0+)?$/.test(s), "must be greater than zero"),
  currency: z.string().trim().min(1).max(10),
  reference: z.string().trim().min(1).max(200),
  redirect_url: z.url({ protocol: /^https?$/ }).optional(),
  chains: z.array(ChainId).min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const RecoveryTask = z.object({
  id: z.string(),
  payment_id: z.string(),
  reason: z.string(),
  state: RecoveryState,
  notes: z.string().nullish(),
  created_at: Timestamp,
});

export const PaymentDetail = Payment.extend({
  invoice: Invoice.pick({ id: true, reference: true, amount_expected: true, currency: true, status: true }),
  history: z.array(z.object({ status: z.string(), at: Timestamp, note: z.string().optional() })),
  recovery: RecoveryTask.nullish(),
});

/* -------------------------------------------------------------------------- */
/* Merchant                                                                    */
/* -------------------------------------------------------------------------- */

export const Merchant = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  settlement_address: z.string().nullish(),
  settlement_asset: z.string().nullish(),
  settlement_verified: z.boolean(),
  webhook_url: z.string().nullish(),
  fee_bps: z.number().int(),
  created_at: Timestamp,
});

export const UpdateMerchantInput = z.object({
  settlement_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be an EVM address").optional(),
  settlement_asset: z.string().min(1).optional(),
  webhook_url: z.url({ protocol: /^https$/ }).optional(),
});

const AssetAmount = z.object({ asset: z.string(), amount: Amount });

export const Balance = z.object({
  settled: z.array(AssetAmount),
  unsettled: z.array(AssetAmount),
  display_total: z.object({ currency: z.string(), amount: Amount }).nullish(),
});

export const SettlementChallenge = z.object({
  nonce: z.string(),
  message: z.string(),
  expires_at: Timestamp,
});

/* -------------------------------------------------------------------------- */
/* Links, Earn, Ramps                                                          */
/* -------------------------------------------------------------------------- */

export const PaymentLink = z.object({
  id: z.string(),
  token: z.string(),
  label: z.string(),
  amount: Amount.nullish(),
  currency: z.string(),
  active: z.boolean(),
  uses: z.number().int(),
  created_at: Timestamp,
});

export const CreateLinkInput = z.object({
  label: z.string().trim().min(1).max(100),
  amount: Amount.optional(),
  currency: z.string().trim().min(1).max(10),
});

export const EarnPosition = z.object({
  id: z.string(),
  protocol: z.string(),
  asset: z.string(),
  apy: Amount,
  deposited: Amount,
  earned: Amount,
  updated_at: Timestamp,
});

export const RampCorridor = z.object({
  country: z.string(),
  currency: z.string(),
  status: z.enum(["LIVE", "COMING_SOON", "NOT_OPEN"]),
  daily_cap: Amount.nullish(),
});

/* -------------------------------------------------------------------------- */
/* Public (buyer-facing, unauthenticated)                                      */
/* -------------------------------------------------------------------------- */

/** What a stranger holding the checkout link may see. Nothing merchant-private. */
export const PublicInvoice = z.object({
  token: z.string(),
  status: InvoiceStatus,
  amount_expected: Amount,
  currency: z.string(),
  expires_at: Timestamp,
  merchant_name: z.string(),
  addresses: z.array(InvoiceAddress),
  redirect_url: z.string().nullish(),
});

export const Chain = z.object({
  id: ChainId,
  name: z.string(),
  asset: z.string(),
  minimum: Amount,
  estimated_settlement: z.string(),
});

export const InvoiceEvent = z.object({
  status: InvoiceStatus,
  at: Timestamp,
  payment: Payment.pick({ tx_hash: true, from_chain: true, amount_in: true }).optional(),
});

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                   */
/* -------------------------------------------------------------------------- */

export const paginated = <T extends z.ZodType>(item: T) =>
  z.object({
    data: z.array(item),
    next_cursor: z.string().nullish(),
    has_more: z.boolean(),
  });

const Limit = z.coerce.number().int().min(1).max(100).optional();

export const ListInvoicesQuery = z.object({
  status: InvoiceStatus.optional(),
  cursor: z.string().optional(),
  limit: Limit,
});

export const ListPaymentsQuery = z.object({
  status: PaymentStatus.optional(),
  invoice_status: InvoiceStatus.optional(),
  cursor: z.string().optional(),
  limit: Limit,
});

/**
 * Error body. Flat, because the frontend client reads `message` and `fields`
 * from the top level (frontend/src/lib/api/client.ts) and maps the HTTP status
 * to its own `ApiErrorKind`. `error` is a machine-readable code.
 */
export const ErrorBody = z.object({
  error: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
});
