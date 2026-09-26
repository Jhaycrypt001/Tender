# §10. THE TENDER DASHBOARD — plan

> **Scope.** The signed-in merchant app at `/app/*`. The user owns this (frontend).
> The friend owns every endpoint it calls. This document is the seam.
>
> **Decisions taken (25 Sep 2026), by the user:**
> 1. Audience = **merchant + their money**. Talise-shaped seven-tab nav, not a narrow back-office.
> 2. Aurora surface = **all three products** — Intents Deposits, Swap API, Intents Connect.
> 3. Data policy = **every screen backed by a real API call.** No mock rows, ever. Empty states instead.

---

## 10.0 The one thing to get right

Talise is a **consumer wallet**. Tender is a **merchant checkout**. The seven-tab structure
transfers, but the *meaning* of each tab has to invert, or the dashboard reads as a reskin and
the judges will say so.

| Talise tab | Talise means | **Tender must mean** |
|---|---|---|
| Home | my balance | **money my customers paid me, settled on Monad** |
| Pay | send money to a friend | **pay out: refunds, supplier payments, team splits** |
| Earn | lend my idle cash | **idle settled revenue put to work** (Connect-triggered) |
| Work | invoice a client | **checkout: create a pay link / QR for a buyer** |
| Activity | my transactions | **every payment, every state transition** |
| Requests | ask a friend for money | **payment links — the core Tender object** |
| Ramps | fund/cash out | **settled MON/USDC → merchant's bank** |

The nav *shape* is Talise's. The nav *content* is a payment processor's. That difference is the
whole submission.

**Naming note.** `Work` and `Requests` both mean "ask to get paid" for Talise and would collide
for us. We merge them: **Checkout** owns creating the thing, **Payments** owns watching it. See
§10.2.

---

## 10.1 How this maps to the bounty

The judging criteria, and where each is satisfied. Write this table into the README too — judges
look for it.

| Criterion | Where it lives in the dashboard |
|---|---|
| Working integration of ≥1 Aurora product, demoed live | All three. Deposits = §10.4 Checkout. Swap API = §10.6 Settlement. Connect = §10.7 Earn. |
| Removes a real cross-chain friction point | The buyer never picks a network, never bridges, never holds MON. One QR. §10.4. |
| Correct settlement/refund handling | `UNDERPAID` (auto-refunded) and `NEEDS_RECOVERY` (explicitly **not**) are separate, visible states with separate UI. §10.5. **This is our differentiator — most teams collapse both into "failed".** |
| Clean UX, complexity hidden | Buyer surface = amount + QR + timer. Nothing else. Merchant surface = one settlement asset. |
| Fit + creativity in track (consumer/payments) | A merchant acquiring in 31 chains and settling in one, on Monad. |
| **Bonus:** multi-chain source coverage | Demo takes BTC + SOL + an EVM chain into the same invoice. §10.11. |
| **Bonus:** contract-level composability via Connect | Settled revenue auto-routes into a Monad position the moment it lands. §10.7. |

---

## 10.2 Information architecture

Seven tabs, Talise's shape, Tender's meaning.

```
/app                      → sign-in (BUILT)
/app/welcome              → post-sign-in transition (BUILT)
/app/home                 → Home      · balance settled on Monad, today, recent
/app/pay                  → Pay       · send out: refund, payout, split   [Pay ▾ dropdown]
   /app/pay/refund
   /app/pay/payout
   /app/pay/split
/app/earn                 → Earn      · idle settled revenue → Monad positions (CONNECT)
/app/checkout             → Checkout  · create invoice / pay link / QR    (was Talise "Work")
   /app/checkout/new
   /app/checkout/[id]
/app/activity             → Activity  · every payment, every state, filterable
/app/links                → Links     · reusable payment links           (was Talise "Requests")
/app/ramps                → Ramps     · settled balance → bank
/app/settings             → Settings  · profile, settlement, developers
   /app/settings/settlement       ← settlement address + asset (Swap API)
   /app/settings/developers       ← API keys, webhooks, logs
/app/ask                  → Ask       · natural-language query over your own payments
```

Public, unauthenticated, not in the nav — **this is what the buyer sees**:

```
/pay/[token]              → the checkout page itself. No wallet connect. No account.
```

> ⚠️ `/pay/[token]` is the single most important route in the entire product. It is the only
> thing a buyer ever touches, and it is what gets demoed live. It must be built **first**, before
> any dashboard tab. A beautiful dashboard with no working checkout loses; a plain dashboard with
> a live cross-chain payment wins.

---

## 10.3 Layout shell — extracted from the screenshots

Talise's chrome, measured off the fourteen screenshots supplied.

```
┌────────────────────────────────────────────────────────────────┐
│ [logo] BETA   Home  Pay▾ Earn Work Activity Requests Ramps      │  62px, sticky
│                              ☺  [🇺🇸 USD · $ ▾]  [avatar▾]       │
├────────────────────────────────────────────────────────────────┤
│ ⌐                                                          ¬   │  ← crosshair rails
│         ┌──────────────────────────────────────────┐            │     (we already
│         │            content, max ~1100px          │            │      have .crosshairs)
│         └──────────────────────────────────────────┘            │
│ ∟                                                          ⌐   │
└────────────────────────────────────────────────────────────────┘
```

Details worth copying exactly, because they are why Talise feels finished:

- **Active tab = filled dark pill**, inactive = plain text with a small outline icon.
- **Crosshair registration marks** frame the content column. We already ship `.crosshairs`
  in `globals.css` — reuse it, do not rebuild it.
- **Mono uppercase eyebrows** on every card (`YOUR BALANCE`, `RECENT`, `GOALS`). We have
  `.eyebrow`.
- **Two-column split on Home**: dark hero card left, accent card right, equal height.
- **Secondary action row** under the hero (`ADD MONEY` `RECEIVE` `TOKENS`) — small white
  pill buttons with outline icons.
- **Empty states are first-class**: a soft circular icon tile, a bold line, a dim line, one
  CTA. Talise ships five different ones. *This is exactly what our no-mock-data rule needs.*
- **Currency selector** in the header with flag + code. Ours changes **display only**;
  settlement asset is a separate thing and must never be confused with it.

**Palette inversion — non-negotiable.** Talise is green. Tender is `--color-ink #121111` +
`--color-sand #c48535` on `--color-stone`. Every dark green surface in those screenshots becomes
ink; every mint accent becomes sand. Never ship a green pixel.

**Files:**

```
src/app/(dash)/layout.tsx          route group — dash chrome, auth guard
src/components/dash/shell.tsx      header + rails + content column
src/components/dash/nav.tsx        seven tabs, Pay▾ dropdown, mobile sheet
src/components/dash/card.tsx       the eyebrow+body card used everywhere
src/components/dash/empty.tsx      icon tile + bold + dim + CTA
src/components/dash/money.tsx      amount formatter, display-currency aware
src/components/dash/state-pill.tsx invoice state → coloured pill
```

> **Route-group note.** `/app/page.tsx` (sign-in) must stay outside the authed group, so use
> `src/app/app/(dash)/` for the signed-in tabs and keep sign-in at `src/app/app/page.tsx`.
> The existing `src/app/app/layout.tsx` already hides the marketing nav/footer via
> `body:has(.tender-app-chrome)` — the dash shell nests inside that, it does not replace it.

---

## 10.4 Checkout — Intents Deposits (the core)

**This is the Aurora integration.** Everything else is supporting cast.

### Merchant side — `/app/checkout/new`

One form. Amount, currency, order reference, and which chains to accept. On submit:

```
POST /v1/invoices  { amount, currency, reference, chains[] }
  → backend calls Aurora POST /api/persistent-deposit-address/{apiKey} once PER CHAIN
    (constraint #2: an address is unique per chain — BTC and SOL cannot share one)
  → returns { id, token, addresses: [{chain, address}], expires_at }
```

Merchant gets: a pay link `https://tender.sh/pay/{token}`, a QR of it, and a copy button.

> **`sender` is arbitrary (constraint #6).** The backend passes the invoice id as `sender`.
> This is the unlock: the buyer never connects a wallet, because we mint the address without
> one. Say this out loud in the demo video — it is the single best line in the pitch.

### Buyer side — `/pay/[token]` (public, no auth)

The whole product, in one screen:

```
┌─────────────────────────────┐
│   Pay $49.00                │
│   to Cadence Commerce       │
│                             │
│   Pay with:                 │
│   [₿ Bitcoin] [◎ Solana]    │   ← chain chips, not a <select>
│   [◆ Base]    [₮ Tron]      │
│                             │
│   ┌───────────────┐         │
│   │   QR CODE     │         │   ← regenerates per chosen chain
│   └───────────────┘         │
│   bc1q7x...4k2p      [copy] │
│   Send exactly 0.00046 BTC  │
│                             │
│   ⏱ 14:32 remaining         │
│   ● Waiting for payment     │   ← SSE-driven, never polls the UI
└─────────────────────────────┘
```

Then, live, without a refresh: `Waiting` → `Detected` → `Settling` → **`Paid`**.

Hard rules for this page:
- **No wallet connect button.** Not hidden, not optional — it does not exist.
- **No network switching prompt.** The chips pick which address to show, nothing more.
- **The timer is Tender's, not Aurora's** (constraint #5: addresses are permanent, they never
  expire). Expiry is our invoice semantics imposed on top. Be honest about that in the docs.
- On expiry: the page says what happens to funds sent late, because per constraint #4 a
  sub-minimum or late deposit *is refunded* — that is a real state, not an error.

---

## 10.5 Activity + the refund asymmetry — our differentiator

`/app/activity` is a filterable table of every payment. Filters mirror Talise's pill row:
`All · Paid · Pending · Underpaid · Needs recovery`.

The state pill, and this is the part judges will notice:

| State | Pill | What the merchant is told |
|---|---|---|
| `PENDING` | outline | Waiting for the buyer. |
| `DETECTED` | ink | Seen on the source chain, settling now. |
| `SETTLED` | sand ● | Paid. Amount + asset + source chain. |
| `OVERPAID` | sand ● | Paid, and the excess is recorded. |
| `UNDERPAID` | amber | Below minimum. **Auto-refunded by the quote deadline.** No action needed. |
| `EXPIRED` | grey | Deadline passed with no payment. |
| `NEEDS_RECOVERY` | **red** | Deposit landed, onward settlement failed. **Not auto-refunded. Recovery is explicit.** |

> **Why this wins points.** Aurora's own docs draw a line (constraint #7): failures *before*
> the deposit lands are refunded automatically; a failure *after* it lands is not, and recovery
> must be explicit. Nearly every hackathon entry will render both as a generic "failed" toast.
> We give `NEEDS_RECOVERY` its own red state, its own row in Activity, its own detail page with
> a **Retry** and a **Withdraw** action, and its own webhook event. Put this on a slide.

---

## 10.6 Settlement — Swap API

`/app/settings/settlement`. Two fields and a lot of care.

- **Settlement address** (Monad, chain 143) — where everything lands.
- **Settlement asset** — what everything converts to. This is the Swap API integration:
  whatever the buyer sends, Aurora routes and swaps to the one asset chosen here.

> ⚠️ **Proof-of-control is required before this address goes live.** A settlement address sitting
> behind nothing but a Google session means a phished Gmail redirects every payment the merchant
> will ever receive. I raised this when we planned sign-in and it still stands. Ship either a
> signature challenge (merchant signs a nonce with the destination wallet) or a micro-deposit
> check before the address is allowed to receive. **Do not skip this because it is a hackathon.**
> A judge who asks "what stops me changing this?" needs an answer.

Also here: gas abstraction stated plainly — the merchant needs **no MON** to receive
(constraint #10). That is a headline claim; put it where the merchant sees it.

---

## 10.7 Earn — Intents Connect (the bonus)

`/app/earn` is where the third Aurora product earns its place, and where the "deposit and
execute in one flow" line in the bounty text gets satisfied literally.

**The flow:** a merchant toggles *"put settled revenue to work"*. From then on, a buyer's
payment does not just settle — the same intent carries a `steps[]` entry that deposits the
settled amount straight into a Monad position. One flow, no second transaction, no manual move.

```
buyer pays in BTC ──► Aurora routes ──► settles on Monad ──► Connect steps[] fires
                                                              └─► lend / stake / LP position
```

Constraint #8 says each `steps` entry is a generic call description, so any Monad contract is
reachable. Constraint #9 matters here: `{MIN_AMOUNT_OUT}` resolves post-fee server-side and
must never be mixed with literal amounts across steps — flag that to your friend explicitly,
it is an easy silent bug.

Screen shape follows Talise's Earn exactly: protocol cards with APY, `Your deposit`, a Deposit
button, and a variable-rate disclaimer. Talise's *Round-up & Save* and *Goals* are consumer
features — **drop them**. A merchant does not set a savings goal.

---

## 10.8 The remaining tabs, briefly

**Home** — the two-column split. Left dark card: settled balance on Monad, settlement address,
`CREATE INVOICE` / `PAY LINK`. Right sand card: whichever is most useful now (unsettled total,
or the Earn prompt). Under them the small pill row, then `RECENT` with an empty state.

**Pay** — outbound money, with the `Pay ▾` dropdown Talise uses: `Refund` (against a specific
payment), `Payout` (supplier/contractor), `Split` (one payment fanned to N addresses — a natural
second Connect use). Refund must link back to the originating payment, never a free-form send.

**Links** — reusable payment links (Talise "Requests"): a fixed-amount link a merchant shares
once and many buyers pay. Same object as an invoice with `reusable: true`.

**Ramps** — settled balance → bank. Talise ships this with `NOT OPEN YET` and `COMING SOON`
badges and it still reads as finished, because the states are honest. Do the same: show the
corridor, mark what is not live. **Do not fake a bank payout.**

**Ask** — the natural-language query box over the merchant's own payments ("how much did I take
last week?", "show unsettled"). Cheap to build on top of the same API, and it demos well. Build
it last; it is the first thing to cut if time runs short.

---

## 10.9 Build order

Dependency-ordered. Each step is demoable on its own, which matters when time runs out.

| # | Step | Blocked by |
|---|---|---|
| 1 | Dash shell — layout, nav, card, empty, state-pill | nothing |
| 2 | **`/pay/[token]` buyer checkout** | `GET /public/invoices/:token` |
| 3 | `/app/checkout/new` + invoice detail | `POST /v1/invoices` |
| 4 | Live status on the buyer page (SSE) | `/public/invoices/:token/events` |
| 5 | `/app/activity` + the seven state pills | `GET /v1/invoices` |
| 6 | `/app/home` | the two above |
| 7 | `/app/settings/settlement` **+ proof-of-control** | `PATCH /v1/merchant` |
| 8 | `/app/settings/developers` — keys, webhooks, logs | merchant auth |
| 9 | `/app/earn` — Connect | Connect integration |
| 10 | `/app/pay` — refund / payout / split | payout endpoints |
| 11 | `/app/links`, `/app/ramps` | link + ramp endpoints |
| 12 | `/app/ask` | nothing new; cut first if short |

**Steps 2–4 are the submission.** Everything from 5 down is supporting evidence. If the clock
runs out at step 6 you still have a winning demo; if you build 1 and 6–12 but not 2–4, you have
nothing to show.

---

## 10.10 Frontend contract — what the friend must ship

Already specified in §5 and `/docs`. The dashboard adds these, and nothing here is optional:

```
GET    /v1/merchant/balance      settled, unsettled, per-asset
GET    /v1/payments              filterable by state, paginated       ← Activity
GET    /v1/payments/:id          detail + state history               ← recovery UI
POST   /v1/payments/:id/refund
POST   /v1/payments/:id/retry    NEEDS_RECOVERY → retry
POST   /v1/payments/:id/withdraw NEEDS_RECOVERY → withdraw
GET    /v1/links                 reusable payment links
POST   /v1/links
GET    /v1/earn/positions        Connect positions
POST   /v1/earn/deposit
GET    /v1/ramps/corridors       which are live, which are not
POST   /v1/merchant/settlement/challenge   proof-of-control nonce
POST   /v1/merchant/settlement/verify      signature check
```

Every one returns the zod-validated shapes from `packages/contract`. **The frontend imports
those types; it never redeclares them.** That package is what stops the two halves drifting
while you build in parallel.

---

## 10.11 Demo script

The order matters. Lead with the thing no one else has.

1. Merchant creates a $49 invoice. Four chains offered.
2. Open the pay link **on a phone**. Show: no wallet connect, no network picker, no account.
3. Pay from **Solana**. Watch the page go `Waiting → Detected → Paid` with no refresh.
4. Cut to the dashboard: settled on **Monad**, in the merchant's chosen asset, merchant never
   touched MON.
5. Show the webhook that fired on the merchant's server.
6. **Deliberately underpay a second invoice.** Show `UNDERPAID`, and that it auto-refunds.
7. **Show a `NEEDS_RECOVERY` payment** and the explicit Retry / Withdraw actions. Say the line:
   *"Aurora auto-refunds deposit-stage failures but not post-deposit ones, so we model both."*
8. If Connect is in: show a payment that lands **and opens a position in the same flow**.
9. Bonus coverage: BTC + SOL + EVM all into the same invoice.

Beats 6 and 7 are what separate this from every other entry. Do not cut them for time — cut
Ask, cut Links, cut Ramps, keep 6 and 7.

---

## 10.12 Verification

- Every route renders with **zero rows** and looks finished (empty states, not blank panels).
- No screen renders a number that did not come from an API response.
- 375 / 414 / 768 / 1024 / 1440: `scrollWidth === clientWidth`.
- `prefers-reduced-motion`: no pinning, no parallax.
- Keyboard: every tab, dropdown, filter pill and table row reachable; focus rings visible.
- Signed-out user hitting any `/app/*` route redirects to `/app`, never flashes content.
- The buyer page works with **JS throttled and on a cold 3G profile** — buyers are on phones.
- **Not one green pixel.**

---

## 10.13 Open questions for the friend

Carried from §2, still unconfirmed, and each one changes UI:

1. Exact enum of Aurora deposit status values → drives the state pills.
2. Full `persistent-deposit-status` field list → drives the payment detail page.
3. Supported destination assets on Monad → drives the settlement-asset picker.
4. Minimum deposit per chain → the buyer page must show it *before* they send, or
   constraint #4 turns into a support ticket.
5. Whether exact-output amounts are supported → decides whether "send exactly X" is truthful.
6. API rate limits → decides poller interval and whether SSE fans out from one poll.
