/**
 * The Tender API contract, in TypeScript.
 *
 * ⭐ THIS FILE IS THE SEAM BETWEEN THE TWO HALVES OF THE PROJECT.
 *
 * The frontend imports it to build screens; the backend implements it. Both
 * sides agree here first, in one file, so neither can drift while they are
 * built in parallel. Changing a shape here is a conversation, not a commit.
 *
 * Every shape below is taken from what `/docs` already publishes to the world
 * (see `src/lib/docs.ts`) and from BACKEND.md §5. Where the two could differ,
 * the published page wins — it is a promise we have already made.
 *
 * Two conventions run through the whole file and are easy to get wrong:
 *
 *   1. THE WIRE IS snake_case. `amount_expected`, not `amountExpected`. The
 *      backend is Prisma/camelCase internally and serialises to snake_case at
 *      the edge. We keep the wire shape verbatim here rather than converting,
 *      so that what you read in this file is exactly what comes back on the
 *      network — no mental translation while debugging.
 *
 *   2. MONEY IS ALWAYS `string`, NEVER `number`. An 18-decimal on-chain value
 *      does not survive a JSON float: 0.1 + 0.2 is the cheap demonstration,
 *      but the real failure is silent precision loss on large token amounts.
 *      Format these for display; never parse one to do arithmetic.
 */

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * A decimal amount as a base-10 string, e.g. "49.00" or "0.000461".
 * Never a number. See note 2 above.
 */
export type Amount = string;

/** ISO 8601 UTC, e.g. "2026-09-24T14:32:00Z". */
export type Timestamp = string;

/**
 * Chain identifiers as the backend spells them. Lowercase, no spaces.
 * The authoritative list comes from `GET /public/chains` at runtime — this
 * type exists for the chains we name in code (the demo set), not as a closed
 * set. Hence the `(string & {})` escape: it keeps autocomplete for the known
 * names without rejecting a chain the API adds later.
 */
export type ChainId =
  | "bitcoin"
  | "solana"
  | "base"
  | "ethereum"
  | "arbitrum"
  | "tron"
  | "monad"
  | (string & {});

/* -------------------------------------------------------------------------- */
/* Invoice                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every state an invoice can reach. Published at /docs, so this list is a
 * public commitment: six of the eight are terminal and never move again.
 *
 * ⚠️ UNDERPAID and NEEDS_RECOVERY are NOT the same kind of failure, and the UI
 * must never render them alike:
 *
 *   UNDERPAID       — the deposit was below the minimum. Aurora refunds this
 *                     automatically by the quote deadline. Nobody acts.
 *   NEEDS_RECOVERY  — the deposit LANDED and the onward settlement then failed.
 *                     Aurora does NOT auto-refund this. Recovery is explicit:
 *                     a human retries or withdraws.
 *
 * That asymmetry is real behaviour of the underlying network, not a Tender
 * invention, and modelling it is the thing most integrations get wrong.
 */
export type InvoiceStatus =
  | "PENDING"
  | "DETECTED"
  | "SETTLED"
  | "OVERPAID"
  | "UNDERPAID"
  | "EXPIRED"
  | "CANCELLED"
  | "NEEDS_RECOVERY";

/** The six states an invoice can never leave. */
export const TERMINAL_STATUSES: readonly InvoiceStatus[] = [
  "SETTLED",
  "OVERPAID",
  "UNDERPAID",
  "EXPIRED",
  "CANCELLED",
  "NEEDS_RECOVERY",
] as const;

export function isTerminal(status: InvoiceStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * One deposit address, on one chain.
 *
 * There is one of these PER CHAIN, because Aurora's addresses are unique per
 * chain — a Bitcoin address and a Solana address cannot be the same string.
 * So an invoice accepting four chains carries four addresses, and the buyer
 * page shows whichever one matches the chain they picked.
 */
export type InvoiceAddress = {
  chain: ChainId;
  address: string;
  /**
   * The minimum that chain will accept, **in USD** — not in the chain's own
   * asset. Below this, Aurora refunds the deposit automatically, so the buyer
   * has to see this number BEFORE they send, or the refund arrives as a
   * surprise and becomes a support ticket.
   *
   * ⚠️ USD, because a chain can carry more than one asset — Ethereum takes ETH
   * and USDC both, and one minimum has to cover them. It MUST be rendered with
   * a currency marker: a bare "8.45" beside the word Bitcoin reads as 8.45 BTC,
   * which is about six figures of overpayment. Use `UsdMinimum`.
   *
   * Optional because the backend may not have it wired yet.
   */
  minimum?: Amount;
};

export type Invoice = {
  /** "inv_" prefixed. Merchant-facing, never in a public URL. */
  id: string;
  /**
   * "chk_" prefixed. This is what goes in the checkout URL.
   *
   * It is deliberately NOT the id: the id is enumerable and merchant-private,
   * while this is a high-entropy random token that carries nothing. Never put
   * `id` in a buyer-facing link.
   */
  token: string;
  status: InvoiceStatus;
  amount_expected: Amount;
  currency: string;
  /** The merchant's own order id. Unique per merchant, and the idempotency key. */
  reference: string;
  expires_at: Timestamp;
  created_at: Timestamp;
  redirect_url?: string | null;
  metadata?: Record<string, unknown> | null;
  addresses: InvoiceAddress[];
  /** Present on a single-invoice fetch; omitted from list responses. */
  payments?: Payment[];
};

/** Body of POST /v1/invoices. */
export type CreateInvoiceInput = {
  amount_expected: Amount;
  currency: string;
  reference: string;
  redirect_url?: string;
  /** Which chains to accept. Omitted means the merchant's configured default. */
  chains?: ChainId[];
  metadata?: Record<string, unknown>;
};

/* -------------------------------------------------------------------------- */
/* Payment                                                                    */
/* -------------------------------------------------------------------------- */

export type PaymentStatus = "DETECTED" | "SETTLED" | "FAILED" | "REFUNDED";

/**
 * One deposit against one invoice.
 *
 * ⚠️ An invoice can have MORE THAN ONE payment. Aurora quotes and processes
 * each deposit independently and cannot batch two partial payments into one
 * settlement, so two half-payments are two rows here — not one combined
 * payment. Never sum these and call the invoice settled.
 */
export type Payment = {
  id: string;
  invoice_id: string;
  /** The source-chain transaction. Unique — this is how duplicates are caught. */
  tx_hash: string;
  from_chain: ChainId;
  /** What the buyer actually sent, in the source asset. */
  amount_in: Amount;
  /** What landed at the merchant's address, in the settlement asset. */
  amount_settled?: Amount | null;
  /** The address that sent the deposit on the buyer's chain, when Aurora reported it. May be an exchange's wallet. */
  sender?: string | null;
  /** Total already sent back to buyers for this payment (submitted or confirmed refunds). */
  refunded_amount?: Amount | null;
  status: PaymentStatus;
  first_seen_at: Timestamp;
  settled_at?: Timestamp | null;
  /** "invoice": paid against an invoice. "deposit": sent straight to the standing deposit address. */
  source: "invoice" | "deposit";
};

/**
 * The merchant's standing deposit address: one permanent address that works for
 * any payer, with no invoice. Each deposit shows up as a payment with source
 * "deposit". `settles_to` is the merchant's own wallet and is NOT a place to send to.
 */
export type DepositAddress = {
  address: string;
  /** What it settles as, on Monad. */
  asset: string;
  settles_to: string;
  /** `minimum` is USD, measured, and absent when unknown. */
  chains: { chain: ChainId; minimum?: Amount }[];
};

/**
 * A payment needing explicit recovery: the deposit succeeded but the onward
 * settlement failed, and Aurora does not refund that case automatically.
 * Attached to the payment detail screen, which offers Retry and Withdraw.
 */
export type RecoveryTask = {
  id: string;
  payment_id: string;
  reason: string;
  state: "OPEN" | "RETRYING" | "WITHDRAWN" | "RESOLVED" | "FAILED";
  notes?: string | null;
  created_at: Timestamp;
};

/** Payment detail: the payment, its invoice, its history, and any recovery. */
export type PaymentDetail = Payment & {
  invoice: Pick<Invoice, "id" | "reference" | "amount_expected" | "currency" | "status">;
  history: { status: string; at: Timestamp; note?: string }[];
  recovery?: RecoveryTask | null;
};

/* -------------------------------------------------------------------------- */
/* Merchant                                                                   */
/* -------------------------------------------------------------------------- */

export type Merchant = {
  id: string;
  name: string;
  email: string;
  /** Where money lands. On Monad, chain 143. */
  settlement_address?: string | null;
  /** What everything converts to before it lands. */
  settlement_asset?: string | null;
  /**
   * ⚠️ Whether the settlement address has been proven to belong to this
   * merchant. Until this is true the address must NOT be used: an unverified
   * address behind nothing but a session means a stolen account silently
   * redirects every future payment. The UI gates on this.
   */
  settlement_verified: boolean;
  webhook_url?: string | null;
  /** Tender's fee in basis points (50 = 0.50%). Currently always 0. */
  fee_bps: number;
  created_at: Timestamp;
};

export type UpdateMerchantInput = {
  settlement_address?: string;
  settlement_asset?: string;
  webhook_url?: string;
};

/** Per-asset settled/unsettled totals for the Home screen. */
export type Balance = {
  /** Landed and final. */
  settled: { asset: string; amount: Amount }[];
  /** Detected but not yet final. */
  unsettled: { asset: string; amount: Amount }[];
  /** Optional convenience total in the merchant's display currency. */
  display_total?: { currency: string; amount: Amount } | null;
};

/** Proof-of-control: the nonce the merchant signs with the settlement wallet. */
export type SettlementChallenge = {
  nonce: string;
  /** The exact string to sign. Show it verbatim; do not reconstruct it. */
  message: string;
  expires_at: Timestamp;
};

/**
 * A merchant API key as listed in Settings → Developers. Never the key itself:
 * only its first characters, so the merchant can recognise which one it is.
 */
export type ApiKeySummary = {
  id: string;
  /** e.g. "tk_live_ab12cd34". */
  prefix: string;
  created_at: Timestamp;
  /** Null until the key is first used. Updated at most once a minute. */
  last_used_at: Timestamp | null;
};

export type ApiKeyList = { data: ApiKeySummary[] };

/**
 * A key that was just created. ⚠️ `key` is in this response and nowhere else,
 * ever: show it once, with a copy button, and never store it.
 */
export type CreatedApiKey = {
  id: string;
  key: string;
  prefix: string;
  created_at: Timestamp;
};

/** ⚠️ Shown once. The previous secret stops verifying immediately. */
export type RotatedWebhookSecret = { webhook_secret: string };

/** `retrying` has attempts left; `failed` used every retry and is not sent again. */
export type WebhookDeliveryStatus = "delivered" | "retrying" | "failed";

/** One webhook delivery, so a merchant can see which events never arrived. */
export type WebhookDelivery = {
  id: string;
  event: string;
  invoice_id: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  last_error: string | null;
  next_retry_at: Timestamp | null;
  delivered_at: Timestamp | null;
  created_at: Timestamp;
};

export type WebhookDeliveryList = { data: WebhookDelivery[] };

/* -------------------------------------------------------------------------- */
/* Links, Earn, Ramps                                                         */
/* -------------------------------------------------------------------------- */

/** A reusable payment link: one link, many buyers, many invoices. */
export type PaymentLink = {
  id: string;
  token: string;
  label: string;
  /** Null means the buyer chooses the amount. */
  amount?: Amount | null;
  currency: string;
  active: boolean;
  /** How many invoices this link has produced. */
  uses: number;
  created_at: Timestamp;
};

export type CreateLinkInput = {
  label: string;
  amount?: Amount;
  currency: string;
};

/** A position opened with settled revenue, via Intents Connect. */
export type EarnPosition = {
  id: string;
  protocol: string;
  asset: string;
  /** Annual percentage yield as a string, e.g. "4.20". Variable. */
  apy: Amount;
  deposited: Amount;
  earned: Amount;
  updated_at: Timestamp;
};

/**
 * An off-ramp corridor. Most are not live, and the UI says so honestly rather
 * than pretending — a corridor marked COMING SOON reads as finished; a faked
 * bank payout does not.
 */
export type RampCorridor = {
  country: string;
  currency: string;
  status: "LIVE" | "COMING_SOON" | "NOT_OPEN";
  /** Per-day limit in the local currency, when there is one. */
  daily_cap?: Amount | null;
};

/* -------------------------------------------------------------------------- */
/* Public (buyer-facing, unauthenticated)                                     */
/* -------------------------------------------------------------------------- */

/**
 * What the checkout page is allowed to see.
 *
 * ⚠️ Deliberately NOT an `Invoice`. This shape carries no merchant email, no
 * settlement address, no internal id and no other invoice — only what a
 * stranger holding the link may know. Keep it that way when it changes.
 */
export type PublicInvoice = {
  token: string;
  status: InvoiceStatus;
  amount_expected: Amount;
  currency: string;
  expires_at: Timestamp;
  /** Display name only. Nothing else about the merchant. */
  merchant_name: string;
  addresses: InvoiceAddress[];
  redirect_url?: string | null;
};

/**
 * What a buyer may see about a payment link before opening it. Reading it
 * creates nothing and does not count as a use, so it is safe to fetch on page
 * load (unlike opening the link, which mints an invoice).
 */
export type PublicLink = {
  label: string;
  /** Null for an open-amount link: the buyer chooses. */
  amount: Amount | null;
  currency: string;
  merchant_name: string;
  /** False once the merchant has turned the link off. */
  active: boolean;
};

/** Display-currency rates, from GET /public/fx. Presentation only. */
export type Fx = {
  base: "USD";
  /** When the rates were published (ISO 8601). They update about once a day. */
  as_of: string;
  /** Units of each currency per 1 USD, as decimal strings. */
  rates: Record<string, string>;
};

/** One supported chain, from GET /public/chains. */
export type Chain = {
  id: ChainId;
  name: string;
  /** The asset a buyer sends on this chain, e.g. "BTC", "USDC". */
  asset: string;
  /**
   * Below this, the deposit is auto-refunded. Show it before they send.
   * **In USD**, not in `asset` — one chain can carry several assets, so the
   * minimum is quoted in dollars. Render it with a currency marker.
   */
  minimum: Amount;
  /** Human estimate, e.g. "about 2 minutes". */
  estimated_settlement: string;
};

/** The SSE payload on /public/invoices/:token/events. */
export type InvoiceEvent = {
  status: InvoiceStatus;
  at: Timestamp;
  payment?: Pick<Payment, "tx_hash" | "from_chain" | "amount_in">;
};

/* -------------------------------------------------------------------------- */
/* Envelopes                                                                  */
/* -------------------------------------------------------------------------- */

export type Paginated<T> = {
  data: T[];
  /** Opaque. Pass back as `cursor` to get the next page. */
  next_cursor?: string | null;
  has_more: boolean;
};

export type ListInvoicesQuery = {
  status?: InvoiceStatus;
  cursor?: string;
  limit?: number;
};

export type ListPaymentsQuery = {
  status?: PaymentStatus;
  invoice_status?: InvoiceStatus;
  cursor?: string;
  limit?: number;
};

/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Failure kinds the UI has to tell apart.
 *
 * `not_configured` is the one that matters most today: it is what every call
 * returns while NEXT_PUBLIC_API_URL is unset, which is the normal state until
 * the backend is live. Screens treat it as "no data yet" and render their
 * empty state — not as a crash.
 */
export type ApiErrorKind =
  | "not_configured"
  | "network"
  | "unauthorized"
  | "not_found"
  | "validation"
  | "rate_limited"
  | "server"
  | "unknown";

export type ApiError = {
  kind: ApiErrorKind;
  message: string;
  /** HTTP status, when there was a response at all. */
  status?: number;
  /** Field-level detail from a validation failure. */
  fields?: Record<string, string>;
};

/**
 * Every call returns this instead of throwing.
 *
 * A failed request is an ordinary, expected outcome here — the backend is not
 * up yet — so making it a value rather than an exception forces each screen to
 * handle it, and makes "error" a designed state rather than a blank page.
 */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };


/* -------------------------------------------------------------------------- */
/* Transfers: money sent OUT of the merchant's own wallet                      */
/* -------------------------------------------------------------------------- */

export type TransferKind = "PAYOUT" | "REFUND" | "SPLIT";
export type TransferStatus = "AWAITING_SIGNATURE" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "EXPIRED";

/** Where a cross-chain line is going after Aurora carries it, and whether it has arrived. */
export type TransferDestination = {
  chain: string;
  chain_name: string;
  address: string;
  asset: string;
  expected_out?: string | null;
  status: "PENDING" | "DELIVERED" | "FAILED";
  delivered_at?: Timestamp | null;
};

export type TransferLine = {
  /** For a cross-chain line this is the one-off Monad address the wallet signs to; `dest` holds the real recipient. */
  to: string;
  amount: Amount;
  dest?: TransferDestination | null;
};

/** What the merchant's wallet must sign for one line (EIP-712 typed data, EIP-3009). */
export type TransferAuthorization = {
  index: number;
  typed_data: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: "TransferWithAuthorization";
    message: Record<string, string>;
  };
};

/** A chain a payout or refund can be sent to, and what the recipient receives there. */
export type PayoutChain = {
  id: string;
  name: string;
  /** What the recipient receives, e.g. USDC, or the chain's own coin where it has no stablecoin. */
  asset: string;
  /** True when exchange deposit addresses on this chain need a memo or tag, which cannot be attached. */
  memo_risk: boolean;
};

export type QuoteTransferInput = { dest_chain: string; to: string; amount: string };

export type QuoteTransferResult =
  | {
      ok: true;
      /** What the recipient receives. */
      asset: string;
      /** About how much of it, in whole units. Null when Aurora did not say. */
      receive: string | null;
      seconds: number | null;
    }
  | { ok: false; field: "to" | "amount" | "chain"; message: string };

export type Transfer = {
  id: string;
  kind: TransferKind;
  status: TransferStatus;
  asset: string;
  from: string;
  total_amount: Amount;
  payment_id?: string | null;
  note?: string | null;
  tx_hash?: string | null;
  failure_reason?: string | null;
  lines: TransferLine[];
  created_at: Timestamp;
  expires_at: Timestamp;
  submitted_at?: Timestamp | null;
  confirmed_at?: Timestamp | null;
  /** Only on a freshly prepared transfer: what to sign, one entry per line. */
  authorizations?: TransferAuthorization[];
};

export type PrepareTransferInput = {
  kind: TransferKind;
  lines: {
    to: string;
    amount: string;
    /** Send this line to another chain. Absent or "monad" is a plain Monad transfer. */
    dest_chain?: string;
  }[];
  payment_id?: string;
  note?: string;
};

export type SubmitTransferInput = { signatures: string[] };

export type WalletBalance = {
  address?: string | null;
  asset?: string | null;
  /** The wallet's on-chain balance of its settlement asset. Null when it cannot be read. */
  balance?: Amount | null;
  /** Whether sending from Tender is possible right now, and if not, why. */
  can_send: boolean;
  reason?: string | null;
};
