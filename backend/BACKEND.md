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
3. **Never edit `src/`.** Your work lands in `apps/api/` and `packages/contract/`.
4. **Aurora's API is called from exactly one directory** (`aurora/`). Nowhere else.

---

## 1. Verified Aurora constraints

Every one of these was confirmed against Aurora's live documentation. They are load-bearing: each one dictates a specific design decision below. Do not design around your assumptions about how a payment processor "usually" works — design around these.

| # | Constraint | What it forces |
|---|---|---|
| 1 | **Aurora has no webhooks** (marked "coming soon") | You MUST own a poller. It is the heart of the system. §6. |
| 2 | **Deposit addresses are unique per chain.** BTC and SOL cannot share one | One invoice = **N addresses**, one per accepted chain. Not one address. |
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
POST /api/persistent-deposit-address/{apiKey}
  body { recipient, sender, depositChain, destinationChain, destinationAsset }
   ->   { depositAddress, alreadyExists }

POST /api/deposit/submit/{apiKey}
  body { txHash, depositAddress }
  optional; accelerates processing when the buyer gives us a tx hash

GET  /api/persistent-deposit-status/{apiKey}?type=received|success|failed&address=...
   ->   { deposits: [ { amount, fromChain, destinationChain, ... } ] }
```

**Intents Connect** (for §9 only): `/api/v1/executions/{wallet}`, `/submit`, `/intermediary`. ERC-191 signing.

**Monad:** chain id **143** · RPC `https://rpc.monad.xyz` · MON 18 decimals.

### Business model (verified)

60/40 revenue split in the integrator's favour. Integrator fee up to **100 bps**. Aurora floor is `max(2 bps, 40% of integrator fee)`. One integrator may generate **as many API keys as needed**, each with independent fee settings → **one Aurora API key per merchant**. Fees accrue and auto-withdraw at a $1,000 default threshold. No custody, no license, no float.

### Open questions — resolve these in Aurora Studio before coding

Research was cut short. The design below assumes none of these and degrades safely if they differ, but **two of them block the frontend**, so answer those two first and post the answers in the repo.

1. 🔴 **Exact enum of deposit status values.** *Blocks frontend* — drives the status pills.
2. 🔴 **Minimum deposit per chain.** *Blocks frontend* — must be shown to the buyer **before** they send, or constraint #4 turns into a support ticket.
3. Full field list of `persistent-deposit-status` responses.
4. Supported destination assets on Monad.
5. Whether exact-output amounts are supported (decides whether "send exactly X" is truthful).
6. API rate limits (decides poll interval and whether SSE fans out from one poll).

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript** | Shares types with the frontend via `packages/contract`. Non-negotiable. |
| HTTP | **Fastify** | Fast, schema-first, first-class zod support. |
| DB | **PostgreSQL + Prisma** | Relational state machine with hard uniqueness guarantees. |
| Queue | **Redis + BullMQ** | Durable retries with backoff, out of the box. Needed for webhooks and the poller. |
| Validation | **zod** | The same schemas the frontend imports. Single source of truth. |
| Logs | **pino** | Structured JSON, Fastify-native. |
| Tests | **vitest** | Fast, TS-native. |

Node 20+.

---

## 3. Repository layout

The repo is currently frontend-only. You are converting it to npm workspaces. **Do this carefully in one commit**, because it moves the frontend's files.

> ⚠️ **Coordinate the workspace move with the frontend owner before you push it.** It relocates `src/` into `apps/web/src/` and will conflict with their in-flight work. If they are mid-build, take **Option B** instead and defer the move.

**Option A — full monorepo (preferred):**

```
tender/
├── package.json                # workspaces: ["apps/*", "packages/*"]
├── docker-compose.yml          # postgres + redis
├── .env.example
├── packages/
│   └── contract/               # THE SEAM — both halves import this
│       ├── package.json        # name: "@tender/contract"
│       └── src/
│           ├── types.ts
│           ├── schemas.ts      # zod; source of truth for both sides
│           └── index.ts
├── apps/
│   ├── web/                    # the existing frontend, moved here
│   └── api/                    # YOUR WORK
└── docs/
    ├── api.md
    └── demo-script.md
```

**Option B — no move, if the frontend owner is mid-build:**

```
tender/
├── src/                        # frontend stays exactly where it is
├── packages/contract/          # still shared; frontend imports by relative path
└── apps/api/                   # your work, self-contained
```

Either way, **`packages/contract` exists and both halves import it.** That package is the single most important decision in this document: it is what stops the two halves drifting while they are built in parallel.

### `apps/api/` internal layout

```
apps/api/src/
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
  apiKeyHash         String   // argon2. NEVER store the key itself.
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

  @@unique([invoiceId, chain])        // constraint #2
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
- `@@unique([invoiceId, chain])` — constraint #2, enforced by the database rather than by hope.

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
| 1 | **`packages/contract`** — types + zod schemas | 🔴 **BOTH HALVES. Do this first, today, and tell the frontend owner the moment it lands.** |
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
3. Write `packages/contract` and tell the frontend owner it exists.
4. Mint one real deposit address against the real Aurora API. Nothing else is real until that is.
