# Tender — Backend Build Specification

**Owner:** backend engineer (repo collaborator).
**Audience:** you, and any coding agent you point at this file.
**Status of the other half:** the frontend is being built in parallel, in this same repo, under `src/`. Do not edit `src/` — that is the other half's working tree.

---

## 0. Read this first

Tender is an **any-chain crypto checkout**. A buyer pays with whatever asset they already hold on any of 31+ chains (BTC, SOL, USDT on Tron, USDC on Base…). The merchant is settled in **one asset on Monad**. Nobody bridges, nobody switches networks, nobody needs MON.

This is for the **Metropolis hackathon, Aurora Intents × Monad bounty**. It is judged on a **live, non-mocked** integration.

### The one idea that defines the whole backend

> Aurora gives us **permanent deposit addresses**. Commerce needs **expiring invoices**.
>
> The backend's entire job is to impose invoice semantics — an amount owed, a deadline, under/overpayment, one-shot fulfilment — on top of an address primitive that has **none of those concepts**.

That mapping *is* the product. Everything below is in service of it.

### Non-negotiables

1. **No mock data anywhere.** Not in dev, not in seeds shown to judges, not in the demo. If a thing is not real, it returns empty, not fake.
2. **The frontend is already published against a fixed contract.** `src/lib/docs.ts` renders a public API reference at `/docs`. The paths, field names, invoice states, ID prefixes and webhook payloads in §5 below are **copied from what that page already promises the world**. They are not suggestions. If you need to change one, tell the frontend owner first — it changes a published page.
3. **Never edit `frontend/`.** Your work lands in `backend/`.
4. **Aurora's API is called from exactly one directory** (`aurora/`). Nowhere else.

---

## 1. Verified Aurora constraints

Every one of these was confirmed against Aurora's live documentation. They are load-bearing: each one dictates a specific design decision below. Do not design around your assumptions about how a payment processor "usually" works — design around these.

| # | Constraint | What it forces |
|---|---|---|
| 1 | **Aurora has no webhooks** (marked "coming soon") | You MUST own a poller. It is the heart of the system. §6. |
| 2 | **Deposit addresses are unique per chain *family*.** ✅ *Verified live 2026-09-26.* **All EVM chains share one address** — minting for `base` then `arb`, `eth`, `monad` or `evm` returns the same address with `alreadyExists: true`. Every non-EVM chain (BTC, SOL, Tron, …) gets its own | One invoice = **one address per chain family**: one EVM address + one each for the non-EVM chains. Mint the EVM address **once** (`depositChain: "evm"`). On the wire, still return one `addresses[]` entry per accepted chain — the EVM chains simply repeat the same address — so the published contract does not change. |
| 2a | **Stellar deposits require a `memo`.** ✅ *Verified live.* The mint response carries `memo`; a deposit without it is **not credited** | The published `InvoiceAddress` shape has no memo field. **Stellar is out of scope** until the contract carries one — do not offer it. |
| 3 | **Per-deposit quotes, no batching.** Each deposit is processed independently | You **cannot** sum two partial payments into one settlement. Two payments against one invoice are two `Payment` rows. |
| 4 | **Sub-minimum deposits are refunded automatically** (`INCOMPLETE_DEPOSIT` → "refunded by the quote deadline") | Underpayment is a **normal expected state**, not an error. Model it. |
| 5 | **Addresses are permanent.** No TTL, no regeneration, no expiry | Invoice expiry is **Tender's** concept, invented by us, layered on top. An expired invoice's address still works — you must decide and document what happens to late money. |
| 6 | **`sender` is an arbitrary identifier** (minLength 1). An address can be minted with no wallet connected | **This is the core UX unlock.** The buyer never connects a wallet. Pass the invoice id as `sender`. |
| 7 | **Refund asymmetry.** Deposit-stage failures auto-refund. `OPERATION_FAILED` *after* a successful deposit does **NOT** — "recovery is explicit (e.g. retry/withdraw), not an automatic refund" | Needs an explicit **recovery queue** and a merchant-visible `NEEDS_RECOVERY` state. **This is our main differentiator — most hackathon entries collapse both cases into a generic "failed".** Do not skip it. |
| 8 | **`steps[]` entries are generic call descriptions** — any contract can be called | Enables the Earn/Connect feature. §9. |
| 9 | **`{MIN_AMOUNT_OUT}` placeholder** resolves post-fee, worst-case, server-side. Never mix it with literal amounts across steps | Silent-bug risk in Connect. §9. |
| 10 | **Gas abstraction** — the user never needs the destination's native gas token | Merchants need **no MON** to receive. It is a headline claim on the marketing site; it must be true. |

### Aurora API surface

Base: `https://intents-api.aurora.dev`

```
GET  /api/tokens/{apiKey}
   ->   { tokens: [ { assetId, symbol, blockchain, decimals, price, ... } ], asset_stats }

POST /api/persistent-deposit-address/{apiKey}
  body { recipient, sender, depositChain, destinationChain, destinationAsset, confidential? }
   ->   { depositAddress, alreadyExists, memo?, correlationId? }
  429 = a concurrent request is already minting this address; retry.

POST /api/deposit/submit/{apiKey}
  body { txHash, depositAddress }
  optional; accelerates processing when the buyer gives us a tx hash

GET  /api/persistent-deposit-status/{apiKey}?type=received|success|failed&address=...&limit=&offset=
   ->   { deposits: [ { tx_hash, fromChain, destinationChain, asset_id, decimals,
                        amount, from, created_at, intents_account,
                        deposit_address, recipient } ] }
```

Chain codes are Aurora's short aliases (`eth`, `arb`, `base`, `monad`, `btc`, `sol`, `tron`, `evm`, …). Tender's wire names (`ethereum`, `arbitrum`, `bitcoin`, `solana`, …) are mapped in `aurora/mapper.ts` — nowhere else.

**The address identity is** `(apiKey, sender, recipient, depositChain-family, destinationAsset, confidential)`. Same inputs → same address, forever. Different `sender` → different address. That is what makes `sender = invoice id` give every invoice its own addresses.

#### Verified live — 2026-09-26

Probed with a real key (`sender: "tender-smoke-001"`, destination USDC on Monad). No funds moved.

| Check | Result |
|---|---|
| Key valid, `GET /api/tokens` | ✅ 200, 197 tokens |
| Settlement assets on Monad | ✅ **USDC** (6 dp, `nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx`), **USDT0** (6 dp), **MON** (18 dp). Default to USDC. |
| Mint with Monad USDC as destination | ✅ works for `evm`, `sol`, `btc`, `tron`, `stellar` |
| EVM chains share one address | ✅ confirmed (constraint #2) |
| Stellar returns a `memo` | ✅ confirmed (constraint #2a) |
| `persistent-deposit-status` on an unused address | ✅ 200 `{"deposits":[]}` for all three types |
| Minting several families for one `sender` **in parallel** | ⚠️ Aurora answers some of them `429` on the first attempt. The client's retry absorbs it (an invoice with 3 families succeeded live), but it adds latency — if it becomes a problem, mint families sequentially. |

**Not yet verified — needs a real deposit:** whether a `received` entry and its matching `success`/`failed` entry share a `tx_hash`, or how else they link (`intents_account` + amount?). **The poller's dedupe key depends on this** — see §6.

**Intents Connect** (for §9 only): `/api/v1/executions/{wallet}`, `/submit`, `/intermediary`. ERC-191 signing.

**Monad:** chain id **143** · RPC `https://rpc.monad.xyz` · MON 18 decimals.

### Business model (verified)

60/40 revenue split in the integrator's favour. Integrator fee up to **100 bps**. Aurora floor is `max(2 bps, 40% of integrator fee)`. One integrator may generate **as many API keys as needed**, each with independent fee settings → **one Aurora API key per merchant**. Fees accrue and auto-withdraw at a $1,000 default threshold. No custody, no license, no float.

### Open questions — status after the 2026-09-26 live probe

1. ✅ **Deposit status values — answered.** There is **no per-deposit status field** on persistent addresses. Status is *which list a deposit appears in*: `received` (reached the Intents account), `success` (payout to recipient landed), `failed` (payout to recipient failed). The frontend's pills render **Tender's** `InvoiceStatus`, never Aurora's; `aurora/mapper.ts` derives transitions from list membership. (The `PENDING_DEPOSIT … INCOMPLETE_DEPOSIT … REFUNDED` enum in Aurora's docs belongs to the quote-based swap API, not to persistent addresses.)
2. 🔴 **Minimum deposit per chain — still open.** *Blocks frontend.* Not documented anywhere (confirmed via the docs' own search). Next attempt: a `dry: true` quote per chain. Until known, `minimum` stays omitted from `InvoiceAddress` — it is optional in the contract for exactly this reason.
3. ✅ **Status response fields — answered** (from the OpenAPI spec; see the API surface above).
4. ✅ **Destination assets on Monad — answered:** USDC, USDT0, MON.
5. Whether exact-output amounts are supported (decides whether "send exactly X" is truthful). Persistent addresses take no amount at all, so the answer is effectively **no** — the buyer page must say "send at least X", and over/underpayment is judged after the fact.
6. **API rate limits — not documented.** Endpoints may return `429`. Back off on it; keep the poll interval in config.
7. 🟡 **Is a post-deposit payout failure refunded?** Constraint #7's wording does not appear in the Intents *Deposits* docs; `type=failed` exists, but its refund behaviour is undocumented. Keep `NEEDS_RECOVERY` in the design, but **confirm with Aurora (contact@aurora.dev) before claiming the asymmetry to judges.**

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Checked against the frontend's types by `backend/contract`. Non-negotiable. |
| HTTP | **Fastify** | Fast, schema-first, first-class zod support. |
| DB | **PostgreSQL + Prisma** | Relational state machine with hard uniqueness guarantees. |
| Queue | **Redis + BullMQ** | Durable retries with backoff, out of the box. Needed for webhooks and the poller. |
| Validation | **zod** | The same schemas the frontend imports. Single source of truth. |
| Logs | **pino** | Structured JSON, Fastify-native. |
| Tests | **vitest** | Fast, TS-native. |

Node 20+.

---

## 3. Repository layout

**Done (commit 253ed69):** the repo is split into two top-level folders. There are no npm workspaces; each half is its own package.

```
tender/
├── frontend/                   # Next.js app — the frontend owner's. Never edit.
│   └── src/lib/api/types.ts    # ⭐ THE SEAM — the wire contract, as TypeScript types
└── backend/                    # YOUR WORK
    ├── package.json
    ├── docker-compose.yml      # postgres (5433) + redis
    ├── .env.example
    ├── contract/               # zod schemas for the wire contract
    ├── prisma/schema.prisma
    └── src/
```

**The contract.** The frontend owner has already written the wire contract as TypeScript types in `frontend/src/lib/api/types.ts`. The backend does not keep a second copy of those types. `backend/contract/` holds the **zod schemas** that validate requests and shape responses, and a type-level test asserts that `z.infer<schema>` matches the frontend's type exactly. If either side changes a shape alone, `tsc` fails in the backend. That check is what stops the two halves drifting.

### `backend/` internal layout

```
backend/src/
├── server.ts             # Fastify bootstrap, plugin registration, graceful shutdown
├── routes/               # HTTP ONLY: validate -> call service -> shape response
│   ├── invoices.ts
│   ├── merchants.ts
│   ├── payments.ts
│   ├── public.ts         # unauthenticated; the checkout page calls these
│   └── health.ts
├── services/             # ALL business logic. Routes contain none.
│   ├── invoice.service.ts
│   ├── settlement.service.ts
│   ├── merchant.service.ts
│   ├── recovery.service.ts
│   └── webhook.service.ts
├── aurora/               # THE ONLY PLACE THAT TALKS TO AURORA
│   ├── client.ts         # typed wrapper: retries, timeouts, error normalisation
│   ├── mapper.ts         # Aurora status -> Tender status
│   └── types.ts
├── workers/
│   ├── poller.ts         # the heart of the system
│   ├── webhook.worker.ts
│   ├── expiry.worker.ts
│   └── recovery.worker.ts
├── db/
│   ├── schema.prisma
│   └── migrations/
└── lib/
    ├── logger.ts  errors.ts  idempotency.ts  ratelimit.ts  crypto.ts
```

**Architectural rules, enforced in review:**

- A route handler never contains business logic. Validate, delegate, respond.
- Nothing outside `aurora/` calls Aurora. When Aurora ships webhooks or renames a status, **exactly one directory changes**.
- `aurora/mapper.ts` exists *specifically* because open question #1 is unresolved. It isolates that unknown so a wrong guess is a one-file fix.

---

## 4. Data model

```prisma
model Merchant {
  id                 String   @id @default(cuid())
  name               String
  email              String   @unique
  settlementAddress  String?  // Monad, chain 143
  settlementAsset    String?
  settlementVerified Boolean  @default(false)  // see §8
  auroraApiKeyId     String?
  feeBps             Int      @default(40)
  webhookUrl         String?
  webhookSecret      String
  // API keys live in the ApiKey table (hash only, argon2): NEVER store a key itself.
  createdAt          DateTime @default(now())

  invoices  Invoice[]
}

model Invoice {
  id             String   @id                 // "inv_" + nanoid
  token          String   @unique             // "chk_" + nanoid — PUBLIC, not the id
  merchantId     String
  reference      String                       // the merchant's own order id
  amountExpected Decimal  @db.Decimal(36, 18)
  currency       String
  status         InvoiceStatus @default(PENDING)
  expiresAt      DateTime
  redirectUrl    String?
  metadata       Json?
  createdAt      DateTime @default(now())

  merchant  Merchant         @relation(fields: [merchantId], references: [id])
  addresses InvoiceAddress[]
  payments  Payment[]

  @@unique([merchantId, reference])   // idempotency: merchants retry
  @@index([status, expiresAt])        // the poller and expiry worker scan on this
}

model InvoiceAddress {
  id           String  @id @default(cuid())
  invoiceId    String
  chain        String
  address      String
  auroraSender String                          // we pass the invoice id here (constraint #6)
  createdAt    DateTime @default(now())

  invoice  Invoice   @relation(fields: [invoiceId], references: [id])
  payments Payment[]

  @@unique([invoiceId, family])       // one address per chain family (constraint #2)
  @@index([address])
}

model Payment {
  id               String   @id @default(cuid())
  invoiceId        String
  invoiceAddressId String
  auroraTxHash     String   @unique            // DEDUPE. The poller is at-least-once.
  fromChain        String
  amountIn         Decimal  @db.Decimal(36, 18)
  amountSettled    Decimal? @db.Decimal(36, 18)
  status           PaymentStatus
  firstSeenAt      DateTime @default(now())
  settledAt        DateTime?
  raw              Json                        // the untouched Aurora payload

  invoice  Invoice        @relation(fields: [invoiceId], references: [id])
  address  InvoiceAddress @relation(fields: [invoiceAddressId], references: [id])
  recovery RecoveryTask?
}

model WebhookDelivery {
  id          String    @id @default(cuid())
  merchantId  String
  invoiceId   String
  event       String
  payload     Json
  attempts    Int       @default(0)
  nextRetryAt DateTime?
  deliveredAt DateTime?
  lastError   String?

  @@index([deliveredAt, nextRetryAt])
}

model RecoveryTask {
  id        String   @id @default(cuid())
  paymentId String   @unique
  reason    String
  state     RecoveryState @default(OPEN)
  notes     String?
  createdAt DateTime @default(now())

  payment Payment @relation(fields: [paymentId], references: [id])
}

enum InvoiceStatus { PENDING DETECTED SETTLED OVERPAID UNDERPAID EXPIRED CANCELLED NEEDS_RECOVERY }
enum PaymentStatus { DETECTED SETTLED FAILED REFUNDED }
enum RecoveryState { OPEN RETRYING WITHDRAWN RESOLVED FAILED }
```

**Three things here are load-bearing. Do not relax them:**

- `Payment.auroraTxHash @unique` — the poller runs at-least-once and may run twice concurrently. This constraint is what makes that safe.
- `@@unique([merchantId, reference])` — merchants retry creates on network failure. This turns a retry into an idempotent no-op instead of a duplicate charge.
- `@@unique([invoiceId, family])` — constraint #2, enforced by the database rather than by hope. All EVM chains share the one `evm` row.

**Money is `Decimal(36,18)`. Never `Float`.** Never parse an on-chain amount into a JS number.

---

## 5. The API contract

⚠️ **These shapes are already published** at `/docs` on the live marketing site, rendered from `src/lib/docs.ts`. They are the contract the frontend is being built against **right now**. Match them exactly.

### Merchant routes — `Authorization: Bearer <merchant_api_key>`

```
POST   /v1/invoices                  create. Honours `Idempotency-Key` header.
GET    /v1/invoices/:id
GET    /v1/invoices                  list; filter by status/date; paginated
POST   /v1/invoices/:id/cancel
GET    /v1/merchant
PATCH  /v1/merchant
POST   /v1/merchant/webhook/test
```

**`POST /v1/invoices`** — exact request and response, as published:

```jsonc
// request
{
  "amount_expected": "49.00",
  "currency": "USD",
  "reference": "order_8842",
  "redirect_url": "https://yourstore.com/thanks"
}

// response
{
  "id": "inv_2p9xQ4",
  "token": "chk_7Fk2mD9sLq",
  "status": "PENDING",
  "amount_expected": "49.00",
  "currency": "USD",
  "expires_at": "2026-09-24T14:32:00Z",
  "addresses": [
    { "chain": "bitcoin", "address": "bc1q9x...4de03" },
    { "chain": "solana",  "address": "7Fk2...Lq9s" },
    { "chain": "base",    "address": "0x7c2f91...a4de03" }
  ]
}
```

Note: **`snake_case` on the wire.** IDs are prefixed: `inv_`, `chk_`, `evt_`. Amounts are **strings**, never numbers — JSON floats lose precision on 18-decimal values.

> ⭐ **`token` is not `id`.** The checkout URL must never expose an enumerable id or anything merchant-private. Generate the token from a CSPRNG, minimum 128 bits of entropy.

### Public routes — no auth. The checkout page calls these.

```
GET    /public/invoices/:token           invoice + addresses + status. NO PII.
GET    /public/invoices/:token/events    SSE stream of status changes
GET    /public/chains                    supported chains + assets + minimums + est. time
POST   /public/invoices/:token/submit-tx buyer pastes a txHash -> accelerates detection
```

`GET /public/invoices/:token` must leak **nothing**: no merchant email, no settlement address, no other invoice, no internal id. Return the merchant's display name and nothing else about them.

`GET /public/chains` must include the **per-chain minimum deposit** (open question #2). The buyer page shows it before they send. Without it, constraint #4 becomes a support ticket.

### Dashboard routes — needed by the frontend, not yet on `/docs`

The dashboard is being built now against these. They are additive.

```
GET    /v1/merchant/balance                   settled, unsettled, per-asset
GET    /v1/payments                           filter by state, paginated
GET    /v1/payments/:id                       detail + full state history
POST   /v1/payments/:id/refund
POST   /v1/payments/:id/retry                 NEEDS_RECOVERY -> retry     (§7)
POST   /v1/payments/:id/withdraw              NEEDS_RECOVERY -> withdraw  (§7)
GET    /v1/links                              reusable payment links
POST   /v1/links
GET    /v1/earn/positions                     Connect positions (§9)
POST   /v1/earn/deposit
GET    /v1/ramps/corridors                    which are live, which are not
POST   /v1/merchant/settlement/challenge      proof-of-control nonce (§8)
POST   /v1/merchant/settlement/verify         signature check (§8)
```

### Invoice state machine

Published at `/docs`. Six terminal states. **Once terminal, an invoice never moves again.**

```
                        ┌─────────┐
                        │ PENDING │  created, addresses minted
                        └────┬────┘
          ┌──────────┬───────┴───────┬────────────┐
          v          v               v            v
    ┌──────────┐ ┌─────────┐   ┌─────────┐  ┌──────────┐
    │ DETECTED │ │UNDERPAID│   │ EXPIRED │  │CANCELLED │
    │ on-chain │ │ auto-   │   │deadline │  │ merchant │
    │ not yet  │ │ refunded│   │ passed  │  │  action  │
    │ settled  │ │   (#4)  │   └─────────┘  └──────────┘
    └────┬─────┘ └─────────┘
         v
    ┌─────────┐        ┌──────────┐
    │ SETTLED │───────>│ OVERPAID │  settled; excess recorded
    └────┬────┘        └──────────┘
         │
         v  Aurora reports OPERATION_FAILED *after* a successful deposit
    ┌────────────────┐
    │ NEEDS_RECOVERY │  ⚠️ NOT auto-refunded. Explicit queue. (#7)
    └────────────────┘
```

| State | Terminal | Meaning |
|---|---|---|
| `PENDING` | no | Created, addresses minted, nothing received. |
| `DETECTED` | no | A deposit is visible on the source chain but has not settled. |
| `SETTLED` | yes | Full amount landed at the merchant's address in their chosen asset. |
| `OVERPAID` | yes | Settled, and more came in than was owed. Excess recorded. |
| `UNDERPAID` | yes | Below minimum. Refunded automatically by the quote deadline. |
| `EXPIRED` | yes | Deadline passed with nothing received. |
| `CANCELLED` | yes | Merchant cancelled before payment. |
| `NEEDS_RECOVERY` | yes | Deposit succeeded, onward settlement failed. **Not auto-refunded.** |

---

## 6. The poller — the most important component

Aurora has no webhooks (constraint #1). Everything the product does downstream of a payment depends on this loop. Design it defensively; assume it will crash mid-run, be run twice at once, and receive garbage.

**Algorithm:**

1. Run on an interval. **Start at 5s**, make it config, tune after measuring against real rate limits (open question #6).
2. Select invoices in **non-terminal** states (`PENDING`, `DETECTED`) that have at least one address. Batch them.
3. For each address, `GET /api/persistent-deposit-status` across all three types: `received`, `success`, `failed`.
4. **Dedupe on `auroraTxHash`.** Insert with `ON CONFLICT DO NOTHING`. The poller must be safe to run twice.
5. Compare `amount` against `amountExpected` -> `SETTLED` / `UNDERPAID` / `OVERPAID`. Use decimal arithmetic, never floats.
6. On a transition: write the `Payment`, update the `Invoice`, enqueue the webhook, push to SSE. **In one transaction.**
7. On `failed` **after** a successful deposit -> create a `RecoveryTask`, set `NEEDS_RECOVERY`. See §7.
8. Exponential backoff per address on Aurora errors. **One bad address must never stall the loop.**
9. Emit metrics: poll latency, deposits seen, transitions, Aurora error rate.

**Non-negotiable properties:**

- **Idempotent.** Running it twice over the same data produces one `Payment` row. There is a test for this.
- **At-least-once.** Never at-most-once. Losing a settlement is unacceptable; seeing one twice is handled by the unique constraint.
- **Isolated failures.** One address erroring does not block any other.
- **Crash-safe.** A restart mid-poll loses nothing. All state is in Postgres, none in memory.

**When Aurora ships webhooks:** the poller becomes a reconciliation backstop on a long interval rather than the primary path. Write it so that swap is a config change, not a rewrite.

---

## 7. `NEEDS_RECOVERY` — the differentiator

Read constraint #7 again. Aurora auto-refunds failures *before* the deposit lands. A failure *after* it lands is **not** refunded, and recovery is explicit.

Nearly every other hackathon entry will render both cases as a generic "payment failed" toast. We give the second case its own first-class state, its own queue, and its own merchant-facing actions. **This is on a judging slide. Do not cut it.**

Required:

- `RecoveryTask` row created the moment a post-deposit failure is seen.
- `NEEDS_RECOVERY` set on the invoice — a **terminal** state, visible in the dashboard in red.
- `POST /v1/payments/:id/retry` — re-attempt the onward settlement.
- `POST /v1/payments/:id/withdraw` — return funds to a merchant-specified address.
- `invoice.needs_recovery` webhook event.
- `recovery.worker.ts` — retries `OPEN` tasks with backoff; escalates after N attempts.

The demo deliberately produces one of these. It must work on camera.

---

## 8. Security

- **Merchant API keys:** argon2-hashed. Shown once at creation. Rotatable. Never logged, never in an error body.
- **Webhook signing:** `X-Tender-Signature: sha256=<hmac>` over the **raw body**. Timestamped; reject anything older than five minutes. The published verification snippet at `/docs` uses `timingSafeEqual` — match it exactly:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody: string, header: string, secret: string) {
  const expected = "sha256=" + createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- **Rate limits:** per merchant key, and per IP on public routes.
- **Validate everything** with the shared zod schemas. No hand-rolled checks.
- **Public endpoints leak nothing.** Audit `GET /public/invoices/:token` specifically.
- **Aurora API key is server-side only.** Never in a client response, never in a log line.
- **Webhook URLs: block private/loopback/link-local ranges.** This is an SSRF hole otherwise. Re-resolve DNS at request time — a hostname that resolved public once can resolve to `169.254.169.254` later.

> 🔴 **Settlement-address proof-of-control is REQUIRED before an address goes live.**
>
> Today a settlement address sits behind nothing but a Google session. A phished Gmail redirects every payment that merchant will ever receive. Ship **either** a signature challenge (merchant signs a nonce with the destination wallet) **or** a micro-deposit check, gated on `Merchant.settlementVerified`.
>
> That is what `POST /v1/merchant/settlement/challenge` and `/verify` are for. A judge **will** ask "what stops me changing this?" Do not skip it because it is a hackathon.

---

## 9. Intents Connect — the bonus (build last)

Bounty bonus points for "contract-level composability". Constraint #8 says each `steps[]` entry is a generic call description, so any Monad contract is reachable.

The flow: a merchant toggles *"put settled revenue to work"*. From then on, a buyer's payment does not merely settle — the same intent carries a `steps[]` entry that deposits the settled amount straight into a Monad position. One flow, no second transaction.

```
buyer pays in BTC ──> Aurora routes ──> settles on Monad ──> steps[] fires
                                                              └─> lend / stake / LP
```

> ⚠️ **Constraint #9 is a silent-bug generator.** `{MIN_AMOUNT_OUT}` resolves post-fee, worst-case, server-side. **Never mix it with literal amounts across steps.** It will not error; it will just move the wrong amount.

Backs `GET /v1/earn/positions` and `POST /v1/earn/deposit`.

---

## 10. Build order

Dependency-ordered. Each step is independently demoable, which matters when time runs out.

| # | Step | Unblocks |
|---|---|---|
| 1 | **`backend/contract`** — zod schemas, checked against `frontend/src/lib/api/types.ts` | 🔴 **BOTH HALVES. Do this first, today, and tell the frontend owner the moment it lands.** |
| 2 | Prisma schema + migrations + a real (non-fake) seed | everything |
| 3 | **`aurora/client.ts` against the real API** — prove an address can actually be minted | 🔴 **do this on day one.** If Aurora access has a problem, both halves need to know now, not on day four. |
| 4 | `POST /v1/invoices` + per-chain address minting | the dashboard's create flow |
| 5 | **`GET /public/invoices/:token`** | 🔴 **the frontend's buyer checkout page — their single most important screen** |
| 6 | The poller -> settlement transitions | the entire product |
| 7 | SSE stream | the live status on the buyer page |
| 8 | Merchant webhooks + retries | the demo's "webhook fired" beat |
| 9 | Recovery queue + `NEEDS_RECOVERY` | the differentiator |
| 10 | Merchant auth, rate limits, hardening | production-readiness |
| 11 | Dashboard routes (`/v1/payments`, `/v1/merchant/balance`, links) | the remaining dashboard tabs |
| 12 | Metrics + structured logging | credibility |
| 13 | Intents Connect (§9) | bonus points |

**Steps 1, 3 and 5 are the critical path.** Step 1 unblocks the frontend's types immediately. Step 3 de-risks the entire submission. Step 5 turns the frontend's checkout page from empty states into a live product.

### Parallel working agreement

The frontend is being built **right now**, against empty states, calling real endpoints that do not answer yet. Their screens fill in automatically as your endpoints come up.

**So: announce each endpoint as it goes live. Not the whole backend at the end.** The first announcement that matters is step 5.

---

## 11. Testing

- **Unit:** status mapping; amount comparison (exact / under / over, at 18 decimals); webhook signature generation.
- **Integration:** the full invoice lifecycle against a **mocked Aurora** — including underpayment and `OPERATION_FAILED`. (Mocking Aurora *in tests* is correct. Mocking data *in the product* is not.)
- 🔴 **One live end-to-end test against real Aurora.** The bounty says "demoed live, not mocked." This is the deliverable.
- **Idempotency test:** run the poller twice over the same data -> assert exactly one `Payment` row.
- **Concurrency test:** run two pollers at once -> still one `Payment` row per tx hash.

---

## 12. Verification checklist

- `docker-compose up` + migrate + seed runs clean from a fresh clone.
- `curl` an invoice into existence -> addresses come back for **every** configured chain.
- Send a **real** small deposit from a **non-EVM** chain -> invoice reaches `SETTLED`, merchant webhook fires.
- **Deliberately underpay** -> `UNDERPAID`, refund observed.
- **Force a post-deposit failure** -> `NEEDS_RECOVERY`, task created, retry and withdraw both work.
- Kill the API mid-poll, restart -> no duplicate `Payment` rows, state intact.
- Two pollers concurrently -> still one `Payment` row per tx hash.
- `GET /public/invoices/:token` audited: no merchant PII, no settlement address, no other invoices.
- Merchant with **zero MON** receives a payment successfully (constraint #10 is a public claim).

---

## 13. Demo script — what the backend must make possible

Order matters. Beats 6 and 7 are what separate this from every other entry.

1. Merchant creates a $49 invoice. Four chains offered.
2. Open the pay link **on a phone**. No wallet connect, no network picker, no account.
3. Pay from **Solana**. Page goes `Waiting -> Detected -> Paid` with no refresh. *(needs SSE)*
4. Dashboard: settled on **Monad**, in the merchant's chosen asset. Merchant never touched MON.
5. Show the **webhook** that fired on the merchant's server.
6. **Deliberately underpay** a second invoice -> `UNDERPAID`, auto-refunded.
7. **Show a `NEEDS_RECOVERY` payment** and the explicit Retry / Withdraw actions. Say the line: *"Aurora auto-refunds deposit-stage failures but not post-deposit ones, so we model both."*
8. If Connect is in: a payment that lands **and opens a position in the same flow**.
9. Bonus coverage: BTC + SOL + an EVM chain, all into the same invoice.

---

## 14. Out of scope

- **The entire frontend.** Structure, components, routing, styling, state. Your only obligation to it is the contract in §5 — which is deliberately complete enough that it is being built against right now, independently.
- Shopify / WooCommerce plugins — post-hackathon.
- Multi-currency FX beyond what Aurora's routing already provides.

---

## 15. First day

1. Read §1. All ten constraints. They are not background — each one dictates a decision below it.
2. Get Aurora Studio access and **answer open questions #1 and #2**, then post them in the repo. The frontend is blocked on both.
3. Write `backend/contract` and tell the frontend owner it exists.
4. Mint one real deposit address against the real Aurora API. Nothing else is real until that is.

---

## 16. Implementation status — 2026-09-26 (see §17 for the 2026-10-02 update)

What is built, what was decided while building it, and what is honestly not possible yet. Everything below is covered by the test suite (110 tests at the time; 164 by 2026-10-02, see §17: unit, integration against a real Postgres + Redis, and a fake Aurora) unless it says otherwise.

### Built

| Step | What exists |
|---|---|
| 1 Contract | `contract/schemas.ts` + `contract.check.ts`: `tsc` fails if any schema drifts from `frontend/src/lib/api/types.ts` |
| 2 Data model | Prisma migrations; every load-bearing unique constraint enforced by Postgres |
| 3 Aurora client | `src/aurora/` — timeouts, retries, zod-parsed responses, key never logged. Live-tested |
| 4–5 Invoices | Create / list / get / cancel, and the public checkout read. Live-tested against real Aurora |
| 6 Poller | `src/workers/poller.ts` — idempotent, concurrency-safe (row lock), per-address backoff. Live-polled real addresses |
| 7 SSE | `/public/invoices/:token/events` via Redis pub/sub; the frontend's `EventSource` shape |
| 8 Webhooks | Outbox + `webhook.worker.ts`: signed, backoff 30s→8h then gives up, `SKIP LOCKED` claims, SSRF-safe at connect time |
| 9 Recovery | `NEEDS_RECOVERY` + tasks; `/retry`, `/withdraw` — see the decision below |
| 10 Hardening | argon2 keys; Redis-backed rate limits; SSRF guard; settlement proof-of-control (EIP-191 challenge; smart-contract wallets via ERC-1271 over Monad RPC) |
| 11 Dashboard | payments list/detail, balance, links (+ `POST /public/links/:token`), `PATCH /v1/merchant`, webhook test |
| 12 Metrics | Prometheus: API `GET /metrics`, worker on `:9464`. Optional `METRICS_TOKEN` |
| — Chains | `/public/chains` + per-address `minimum`, **measured live** (see below) |
| — Docs | Swagger UI at `/docs` (test fails if it drifts from the routes); `docs/openapi.json`; `docs/demo-script.md` with the corrected recovery line |
| — Crash safety | §12 kill-mid-poll: simulated at three points (mid-transaction, after commit, webhook worker holding a lease) — `test/crash.test.ts` |

### Why BullMQ was not used

The spec chose Redis + BullMQ. It was replaced by a Postgres **outbox** because a status change (Postgres) and a BullMQ job (Redis) cannot share a transaction: commit-then-enqueue can lose a webhook on a crash; enqueue-then-commit can announce a payment that was never recorded. The outbox writes the status change and its webhook row in one transaction, delivered with `SKIP LOCKED` claims and stored backoff. The poller is a periodic scan, not a job queue. `bullmq` was installed but unused and has been removed (2026-10-02).

### Decisions made while building

- **Coverage is judged on what the buyer sent** (USD value at detection, from Aurora's price feed), with a 1% tolerance (`PAYMENT_TOLERANCE_BPS`). Fees come out of what the merchant receives, as with a card — judging on the settled amount would mark every correct payment short.
- **Payments are judged one at a time, never summed** (as `types.ts` requires). A second payment after SETTLED makes it OVERPAID, as `/docs` promises — the one move out of a terminal state, matching the §5 diagram.
- **Deadline and late money.** A deposit that reaches Aurora up to `EXPIRY_GRACE_MINUTES` (15) after the deadline still counts. Later money is recorded against the invoice without reopening it. Closed invoices are watched for `LATE_WINDOW_HOURS` (24).
- **Only the expiry step closes an invoice**, and only after every address was polled successfully past the window. An Aurora outage can never expire a paid invoice. (A test caught the bug this rule fixes.)
- **Minimums are measured, not guessed.** The worker binary-searches dry quotes (`/api/quote`, `dry: true`) per chain every 30 min, refunding to an origin-chain probe address (an Intents-account refund under-measures by ~20%), adds a 20% margin, and caches in Redis. Live on 2026-09-26: Bitcoin $8.45, Tron $3.29, Solana $0.41, Ethereum $0.37, Base $0.19, Arbitrum/Monad $0.02. Minimums are **USD**, because a buyer may send more than one asset on a chain.
- **Payout matching is inferred.** Whether a `success` entry carries the deposit's tx hash is unknown until a real payment; `matchOutcomes` matches on a shared hash first, else chronologically within the invoice's own address.

### Constraint #7 does not apply to persistent addresses

The "`OPERATION_FAILED` is not auto-refunded; recovery is explicit (retry/withdraw)" behaviour is from **Intents Connect executions**. Persistent deposit addresses have **no retry, withdraw or refund API** (confirmed against the docs and their search, 2026-09-26). Aurora's documented route for a stuck payout is a support case at https://aurora.dev/intents-support. So:

- `/retry` re-checks Aurora immediately and keeps watching; if Aurora completes the payout, the payment settles and the task resolves.
- `/withdraw` records the requested destination and attaches a ready-to-file support case. The task stays `OPEN` — it never claims funds moved.
- `/refund` returns `501`.

**Do not tell judges Tender retries or withdraws funds itself.** The accurate line: *"Tender detects a payout that failed after the deposit landed, gives it its own state instead of a generic failure, keeps watching for Aurora to complete it, and hands the merchant a ready support case."*

### Not built

- **Earn / Intents Connect (§9).** Aurora's deposit "Custom Actions" are *coming soon*; Connect needs the merchant's wallet to sign each execution in the browser plus a verified Monad lending integration. `GET /v1/earn/positions` returns `[]`, `POST /v1/earn/deposit` returns `501`.
- **Ramps.** No off-ramp partner: `GET /v1/ramps/corridors` returns `[]`.
- **`tk_test_` sandbox keys**, promised at `/docs`. Aurora has no testnet for persistent addresses.
- **A real end-to-end payment.** Still required: ~$2 from Solana to a live invoice. It verifies payout matching and the deposit → settled path on camera.

---

## 17. Implementation status — 2026-10-02

What changed after §16. 164 tests pass (unit, integration against real Postgres + Redis, fake Aurora). Separately, `npm run e2e:local` ran the whole merchant flow against a local API and worker and the **real** Aurora API, three times in a row, 50 of 50 checks each, moving no money.

### Built since §16

| Area | What exists |
|---|---|
| **Google sign-in to merchant** | `POST /internal/merchants/resolve` (dashboard server only). Upserts on the Google `sub`, never on email. `Merchant.googleSub` is unique. If the sign-in email already belongs to another merchant it is stored as `name+<sub>@domain`, so a new sign-in can never take over an existing account. |
| **Platform key** | `TENDER_PLATFORM_KEY` (`tp_` + 32 random bytes, api only). `requireMerchant` accepts `Bearer tk_live_…` **or** `Bearer tp_…` plus `X-Tender-Merchant`. Constant-time compare; a missing or unknown merchant id is 401, never 404; every platform call logs the merchant it acted for; its own per-merchant rate-limit bucket; redacted from logs. |
| **API keys** | `ApiKey` table (hash only). `GET/POST /v1/merchant/api-keys`, `DELETE /v1/merchant/api-keys/:id`, `POST /v1/merchant/webhook/secret`. Keys shown once, max 10 active, `lastUsedAt` written at most once a minute, revoked keys stop at once. The migration copied every existing key over before dropping `Merchant.apiKeyHash`. |
| **Webhook deliveries** | `GET /v1/merchant/webhook/deliveries?status=&limit=`: `delivered`, `retrying`, `failed` (every retry used). Lets a merchant see which events never arrived. |
| **Webhook signature v2** | `X-Tender-Signature-V2: sha256=<hmac of "<timestamp>.<body>">`, sent alongside the unchanged v1 header. Covers the timestamp, so it cannot be altered or replayed past `WEBHOOK_TOLERANCE_SECONDS` (300). Each retry is re-signed with its own timestamp. `verifyWebhookV2` in `lib/crypto.ts` is the reference verifier. |
| **Link preview** | `GET /public/links/:token`: label, amount (null if open), currency, merchant name, active. Creates nothing, does not count as a use. |
| **30 chains** | `aurora/chains.ts` has all 30 (every `depositChain` Aurora accepts except Stellar). Each `asset` was read from Aurora's live token list (`npm run aurora:tokens`). |
| **Operations** | `Dockerfile` (one image, API and worker), `docs/DEPLOY.md`, worker gauges `tender_poll_lag_seconds`, `tender_webhook_dead_letters`, `tender_chain_minimums_age_seconds`, a loud log line when Aurora answers 401/403, `npm run aurora:measure`, `npm run e2e:local`. |

### Decisions made since §16

- **Default chains are 17, not 7.** Every EVM chain (they share one address, so no extra Aurora call) plus Bitcoin, Solana and Tron. The other 13 non-EVM chains are opt-in per invoice through `chains`, because each is its own family and costs one more mint call.
- **Addresses are minted one family at a time.** Aurora serialises creation per `sender` and answers `429 A concurrent request is creating this deposit address` to concurrent mints for the same invoice. Fired in parallel, the last family could exhaust its 3 retries and the invoice failed with a 502 (seen live on 2026-10-02). Sequential costs about 3 seconds for the default 4 families and cannot collide. This supersedes the "if it becomes a problem, mint sequentially" note in §1.
- **Minimums survive a bad network.** A full 30-chain measurement takes 7 to 13 minutes, not 2 to 3. One chain failing is retried once and then left out; it no longer aborts the run. On a cold start the worker publishes each chain as it is measured, so `/public/chains` answers after the first chain instead of 503 for the whole run. With a previous catalogue present it is left untouched until the new one is complete.
- **A Prisma setting was pinned.** `importFileExtension = "js"` in the schema. Without it, `prisma generate` run in `npm ci` before the tsconfig exists emitted `./internal/class.ts` imports that do not exist in `dist`, and the compiled server could not start. Tests and `tsx` never showed it.

### Facts learned from Aurora (2026-09-30 to 2026-10-02)

- **Persistent deposit address creation is an entitlement, not a bug.** It returned `403 Persistent deposit address creation is not enabled for this API key` for every chain, destination, recipient and sender. Aurora asked us to create an organization in the Client Portal and move the key into it, then enabled the feature. Existing addresses and reading deposits worked throughout. The key with the feature is the one in the `Tender` organization.
- **Only Stellar needs a memo** (Aurora support confirmed). `mintAll` still refuses any family that returns one.
- **There is no rate limit as such** (Aurora support), but they asked for expected volume.
- **Monad as a destination is under maintenance** on Aurora's side (NEAR Intents status). Dry quotes to Monad USDC fail from every origin, so minimums cannot be measured and no payment can settle until it returns. Aurora says deposits made during the maintenance settle when it ends. There is no ETA.
- **Ramp's Monad USDC is the same token Aurora settles in** (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`), checked 2026-10-02. Relevant only to the post-hackathon off-ramp (`docs/OFFRAMP.md`).

### Still not built or not proven

- **A real end-to-end payment** (about $2 from Solana to a live invoice). Blocked on Monad. It still has to confirm payout matching, the PENDING to DETECTED to SETTLED path, the webhook, the underpayment refund and a payment link opened from a phone.
- **Earn / Intents Connect, Ramps, `tk_test_` keys:** unchanged from §16. Ramps is planned for after the hackathon (`docs/OFFRAMP.md`).
- **Not deployed.** The image builds and runs locally; see `docs/DEPLOY.md`.
- **Backups and alert rules** are the database host's and the metrics stack's job; nothing here configures them.
