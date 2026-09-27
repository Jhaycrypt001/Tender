# Tender — Frontend Build Specification

**Owner:** frontend (you).
**Counterpart:** [BACKEND.md](../backend/BACKEND.md) — the backend engineer's spec. Read §5 of it; that is the contract you build against.
**Rule zero:** you never write backend code, and the backend never writes `src/`.

---

## 0. The rule that keeps the two halves from colliding

You are both in one repo. Collisions happen in exactly three places, and all three are avoidable.

| Risk | Rule |
|---|---|
| He converts the repo to a monorepo and moves `src/` to `apps/web/src/` | 🔴 **Tell him to take Option B in BACKEND.md §3 until your dashboard is built.** Your `src/` does not move. If it moves mid-build you lose an evening to conflicts. |
| You both edit `packages/contract` | He owns it. You **import** it. If a shape is wrong, message him — do not edit it. |
| You both edit `src/lib/docs.ts` | You own it. It is the published API reference. If he needs a path changed, he asks you. |

**Files you own, exclusively:**

```
src/app/**          every route and page
src/components/**   every component
src/lib/copy.ts     all landing copy
src/lib/docs.ts     the published API reference
src/lib/auth.ts     Google OAuth session
src/lib/api/**      NEW — your typed API client
public/**           images, fonts, assets
```

**Files he owns, exclusively:** `apps/api/**`, `packages/contract/**`, `docker-compose.yml`, `prisma/**`.

**Shared, coordinate before touching:** `package.json` (root), `.env.example`, `README.md`.

> Practical habit: work on a branch (`feat/dashboard`), pull before you push, and never `git add -A` from the repo root — you will hoover up his half. Add paths explicitly.

---

## 1. The problem this spec solves

You must build seven dashboard tabs plus a buyer checkout, against an API that does not exist yet, **without mocking any data**. Those look like contradictory requirements. They are not.

> **The resolution:** write `src/lib/api/` as the complete, typed client for the real API. Build every screen against it. Today those calls fail or return nothing, so every screen renders its **empty state** or its **error state** — screens you must build anyway, and which Talise ships five variants of. Nothing is faked. The day his endpoints answer, the screens fill with real data and **you change zero component files**.

That is not a workaround. It is the only architecture that lets two people build in parallel without one blocking the other.

**What this means in practice:** a screen is "done" when it renders correctly in all four states — loading, empty, error, and populated — even though only the first three are reachable today.

---

## 2. Design system — what already exists, and what you must not reinvent

Everything below is already in `src/app/globals.css`. **Use it. Do not add a second set of tokens.**

### Tokens

```
--color-ink    #121111   near-black: all text, dark surfaces, primary buttons
--color-sand   #c48535   ochre accent: active state, links, success. USE SPARINGLY
--color-paper  #ffffff   page background
--color-stone  #f0efeb   card tiles, secondary surfaces
--color-mute   #8a8783   secondary text, inactive nav
--color-line   #e6e4e0   hairline borders

--font-display  Instrument Serif   headings
--font-sans     Instrument Sans    UI and body
--font-mono     JetBrains Mono     eyebrows, amounts, addresses, hashes

--ease-out-expo  cubic-bezier(0.22, 1, 0.36, 1)
```

### Utilities that already exist

| Utility | What it does |
|---|---|
| `.shell` | max-width 68rem, centred, responsive padding |
| `.section-y` | vertical section rhythm (+ `-tight-b` / `-tight-t` / `-flush-t` modifiers) |
| `.crosshairs` | corner registration marks on a `relative` element — **this is the Talise look** |
| `.eyebrow` | mono uppercase label with a leading square |
| `.dot-grid` | subtle dot background |

### 🔴 Three traps in this codebase that will cost you an hour each

1. **`.section-y` silently beats every `pt-*` / `pb-*`.** It sets `padding-block` and is emitted *after* Tailwind's padding utilities, so same layer, same specificity, source order decides. Use the `-flush-t` / `-tight-b` modifiers instead. Verify with byte offsets in the built CSS, do not assume.
2. **A bare `#section` link is dead on every page except the landing page.** Always root-relative: `/#chains`, never `#chains`.
3. **`overflow-x: hidden` belongs on `html`, never `body`.** On `body` it creates a scroll container and breaks `position: sticky`.

Plus one for the dashboard specifically: **`src/app/app/layout.tsx` already hides the marketing nav and footer** via `body:has(.tender-app-chrome)`. Your dash shell **nests inside** that. Do not replace it.

### Palette inversion — non-negotiable

Talise is green. **Tender is ink + sand.** Every dark green surface in those screenshots becomes `--color-ink`; every mint accent becomes `--color-sand`. **Not one green pixel.**

---

## 3. What you are building

### Routes

```
src/app/app/page.tsx                 sign-in                        ✅ BUILT
src/app/app/welcome/                 post-sign-in transition        ✅ BUILT
src/app/app/callback/route.ts        OAuth callback                 ✅ BUILT
src/app/app/start/route.ts           OAuth start                    ✅ BUILT
src/app/app/signout/route.ts         sign out                       ✅ BUILT

src/app/app/(dash)/layout.tsx        ⬜ dash chrome + auth guard
src/app/app/(dash)/home/             ✅ Home
src/app/app/(dash)/checkout/         ✅ Checkout: new + [id]
src/app/app/(dash)/activity/         ✅ Activity
src/app/app/(dash)/pay/              ✅ Pay: refund / payout / split
src/app/app/(dash)/links/            ✅ Links
src/app/app/(dash)/earn/             ✅ Earn
src/app/app/(dash)/ramps/            ✅ Ramps
src/app/app/(dash)/settings/         ✅ Settings: settlement + developers
src/app/app/(dash)/ask/              ⬜ Ask (cut first if short on time)

src/app/pay/[token]/page.tsx         ✅ 🔴 THE BUYER CHECKOUT — public, no auth
```

> **Route-group note.** Sign-in must stay at `src/app/app/page.tsx`, **outside** the `(dash)` group, because the dash layout carries the auth guard. A route group `(dash)` adds no URL segment, so `/app/(dash)/home` serves at `/app/home`.

### The seven tabs, and what each means for us

Talise is a consumer wallet. Tender is a merchant checkout. The nav *shape* transfers; the *meaning* inverts. This table is the difference between a product and a reskin.

| Tab | Talise means | **Tender means** |
|---|---|---|
| Home | my balance | money my customers paid me, settled on Monad |
| Pay | send to a friend | pay out: refunds, suppliers, team splits |
| Earn | lend my idle cash | idle settled revenue put to work (Connect) |
| Checkout | invoice a client (Talise "Work") | create a pay link / QR for a buyer |
| Activity | my transactions | every payment, every state transition |
| Links | ask a friend for money (Talise "Requests") | reusable payment links |
| Ramps | fund / cash out | settled MON/USDC to the merchant's bank |

**Two Talise features are deliberately dropped: round-up savings and goals.** A merchant does not set a savings goal. Shipping those is the clearest possible tell that we copied a consumer app.

---

## 4. 🔴 STEP 1 — `src/lib/api/` (do this before any UI)

Nothing else starts until this exists. It is also what you send him.

```
src/lib/api/
├── types.ts       every shape: Invoice, Payment, PaymentState, Merchant,
│                  Balance, Link, Chain, EarnPosition, RampCorridor
├── client.ts      one request() wrapper: base URL, auth, JSON, typed errors
├── invoices.ts    createInvoice, getInvoice, listInvoices, cancelInvoice
├── payments.ts    listPayments, getPayment, refund, retry, withdraw
├── merchant.ts    getMerchant, updateMerchant, getBalance, settlement challenge/verify
├── links.ts       listLinks, createLink
├── earn.ts        getPositions, deposit
├── ramps.ts       getCorridors
└── public.ts      getPublicInvoice, getChains, submitTx   (no auth)
```

**Rules for this layer:**

- Shapes come from BACKEND.md §5. **`snake_case` on the wire** (`amount_expected`, `expires_at`). Either keep snake_case in your types or convert in exactly one place — never half and half.
- **Amounts are strings.** Never `number`. An 18-decimal value does not survive a JSON float. Format for display, never parse for maths.
- IDs are prefixed: `inv_`, `chk_`, `evt_`.
- `client.ts` returns a **discriminated result**, not a throw: `{ ok: true, data } | { ok: false, error }`. Every screen then handles `error` as a real state instead of exploding.
- Base URL from `NEXT_PUBLIC_API_URL`. When it is unset, every call returns a clean "not configured" error, and your empty states show. **That is the intended state today.**

### 🔴 Security: the merchant API key never reaches the browser

Merchant routes need `Authorization: Bearer <key>`. If that key is in client code, anyone reading your JS can drain that merchant's account.

**So: merchant reads happen in server components, and merchant writes go through your own route handlers under `src/app/api/`, which attach the key server-side and proxy to his API.** The browser only ever talks to your own origin.

The one exception is the buyer checkout, which is public, unauthenticated, and needs a live stream — that is a client component using `EventSource`.

### Data fetching — no new dependencies

You have no state library and no data-fetching library, and you do not need either.

- **Reads:** server components + `fetch(..., { cache: "no-store" })`. This is the Next 15 grain.
- **Writes:** server actions, or route handlers under `src/app/api/`.
- **Live buyer status:** `EventSource` against `/public/invoices/:token/events`, in a client component.
- **Polling fallback:** if SSE is not up yet, poll the public invoice endpoint every 5s. Write it so swapping to SSE is a one-function change.

> **Send `types.ts` to him the moment it compiles.** It is the seam. If he builds to different shapes you both lose days.

---

## 5. STEP 2 — the six primitives

Build these before any screen. Every screen is assembled from them.

```
src/components/dash/
├── shell.tsx        header + crosshair rails + content column
├── nav.tsx          seven tabs, Pay ▾ dropdown, mobile sheet, active pill
├── card.tsx         the eyebrow + body card used everywhere
├── empty.tsx        🔴 icon tile + bold line + dim line + one CTA
├── state-pill.tsx   payment state -> coloured pill
├── money.tsx        amount formatter, display-currency aware
├── table.tsx        responsive: table on desktop, stacked cards on mobile
└── field.tsx        labelled input, error text, help text
```

**`empty.tsx` is the most important component you will write this week.** Because nothing is mocked, it is on every screen for however long the backend takes. Talise ships five variants ("Nothing yet", "No invoices yet", "No activity yet"…) and they are why the app reads as finished rather than broken. Give it a soft circular icon tile, a bold line, a dim line, and one CTA.

**`state-pill.tsx` — the eight states.** Its colour vocabulary is a judging point:

| State | Pill | What the merchant is told |
|---|---|---|
| `PENDING` | outline | Waiting for the buyer. |
| `DETECTED` | ink | Seen on the source chain, settling now. |
| `SETTLED` | sand ● | Paid. |
| `OVERPAID` | sand ● | Paid, excess recorded. |
| `UNDERPAID` | amber | Below minimum. **Auto-refunded.** No action needed. |
| `EXPIRED` | grey | Deadline passed, nothing received. |
| `CANCELLED` | grey | Cancelled before payment. |
| `NEEDS_RECOVERY` | **red** | Deposit landed, settlement failed. **Not auto-refunded.** |

> ⭐ `UNDERPAID` and `NEEDS_RECOVERY` must never look alike. One resolves itself; the other needs a human. Most entries collapse both into "failed" — that distinction is our differentiator and it lives in **your** UI.

### The layout shell, measured off the Talise screenshots

```
┌────────────────────────────────────────────────────────────────┐
│ [logo] BETA   Home Pay▾ Earn Checkout Activity Links Ramps      │  62px sticky
│                                    [USD ▾]  [avatar ▾]          │
├────────────────────────────────────────────────────────────────┤
│ ⌐                                                          ¬   │  ← .crosshairs
│         ┌──────────────────────────────────────────┐            │
│         │            content, max 68rem            │            │
│         └──────────────────────────────────────────┘            │
│ ∟                                                          ⌐   │
└────────────────────────────────────────────────────────────────┘
```

Details that make it read as finished: active tab is a **filled ink pill**, inactive is plain text with a small outline icon; **mono uppercase eyebrows** on every card; **dark hero card + light accent card** paired on Home; a small pill row of secondary actions beneath.

The header currency selector changes **display only**. The **settlement asset** is a different thing entirely, lives in Settings, and must never be confused with it.

---

## 6. STEP 3 — 🔴 `/pay/[token]`, the buyer checkout

**Build this before any dashboard tab.**

It is the only screen a buyer ever touches, it is what gets demoed live, and it is what the bounty is actually judging. A plain dashboard with a working cross-chain payment wins. A beautiful dashboard with no checkout loses.

```
┌─────────────────────────────┐
│   Pay $49.00                │
│   to Cadence Commerce       │
│                             │
│   Pay with:                 │
│   [₿ Bitcoin] [◎ Solana]    │  ← chain chips, NOT a <select>
│   [◆ Base]    [₮ Tron]      │
│                             │
│   ┌───────────────┐         │
│   │   QR CODE     │         │  ← regenerates per chosen chain
│   └───────────────┘         │
│   bc1q7x...4k2p      [copy] │
│   Send exactly 0.00046 BTC  │
│   Minimum 0.0001 BTC        │  ← from /public/chains
│                             │
│   ⏱ 14:32 remaining         │
│   ● Waiting for payment     │  ← SSE-driven
└─────────────────────────────┘
```

Then, live and without a refresh: `Waiting -> Detected -> Settling -> Paid`.

**Hard rules:**

- 🔴 **No wallet connect button.** Not hidden, not optional — it does not exist. This is the entire pitch, and it works because the backend mints addresses with an arbitrary `sender` (BACKEND.md constraint #6).
- **No network switching prompt.** The chips choose which address to display. Nothing more.
- **The timer is Tender's, not Aurora's.** Aurora's addresses are permanent and never expire (constraint #5). Expiry is our invoice semantics layered on top. Say so honestly in the docs.
- **Show the per-chain minimum before they send.** Below the minimum, Aurora auto-refunds (constraint #4) — if the buyer does not see it first, that becomes a support ticket.
- **Mobile first, and throttled.** Buyers are on phones, often on bad connections. Test at 375px on a cold 3G profile.
- QR: add a small dependency (`qrcode`) or render server-side. Do not hand-roll it.

---

## 7. STEP 4 onward — the screens

Order matters. Each step is demoable on its own, which is what saves you when time runs out.

| # | Screen | Endpoint it needs | Status today |
|---|---|---|---|
| 4 | `/app/checkout/new` — amount, currency, reference, chain multi-select | `POST /v1/invoices` | form works, submit errors cleanly |
| 5 | `/app/checkout/[id]` — pay link, QR, copy button, live status | `GET /v1/invoices/:id` | empty state |
| 6 | `/app/activity` — filter pills (All/Paid/Pending/Underpaid/Needs recovery), table | `GET /v1/payments` | empty state |
| 7 | Payment detail + 🔴 **Retry / Withdraw** for `NEEDS_RECOVERY` | `GET /v1/payments/:id` | empty state |
| 8 | `/app/home` — dark balance card + sand accent card, pill row, RECENT | `GET /v1/merchant/balance` | empty state |
| 9 | `/app/settings/settlement` — address + asset + 🔴 **proof-of-control** | `PATCH /v1/merchant`, challenge/verify | form works |
| 10 | `/app/settings/developers` — API keys, webhook URL, delivery log | `GET /v1/merchant` | empty state |
| 11 | `/app/pay` — refund / payout / split, step rail like Talise | refund + payout endpoints | empty state |
| 12 | `/app/links` — reusable payment links | `GET/POST /v1/links` | empty state |
| 13 | `/app/earn` — protocol cards, APY, Your deposit, Deposit | `GET /v1/earn/positions` | empty state |
| 14 | `/app/ramps` — corridors, honest `COMING SOON` badges | `GET /v1/ramps/corridors` | empty state |
| 15 | `/app/ask` — natural-language query. **Cut this first.** | payments API | empty state |

**Notes on specific screens:**

- **Payment detail (7)** is where `NEEDS_RECOVERY` earns its judging point. Red state, plain explanation of why it was not auto-refunded, and two real buttons: Retry and Withdraw.
- **Settlement (9):** the address field must be **gated on verification**. Ungated, a phished Gmail redirects every payment that merchant will ever receive. The UI needs a verified/unverified state and a challenge flow. Do not ship the field without it.
- **Ramps (14):** Talise ships this mostly not-live with `NOT OPEN YET` badges and it still reads as finished, because the states are honest. Do the same. **Do not fake a bank payout.**
- **Pay (11):** refund must link back to the originating payment, never be a free-form send.

---

## 8. Integration day

When he messages "the public invoice endpoint is live":

1. Set `NEXT_PUBLIC_API_URL` in `.env.local`.
2. Reload `/pay/[token]` with a real token. It fills with live data.
3. **You change no component code.** If you do, the api layer was leaking into components — fix it there.

Then each endpoint he announces lights up one more screen, one at a time, instead of all seven arriving at once in a panic on the last night.

**Two answers you need from him early, because they block *your* UI:**

1. **The exact deposit-status enum** — drives `state-pill.tsx`.
2. **The per-chain minimum deposit** — must be on the buyer page before they send.

Both are marked 🔴 in BACKEND.md §1 as his day-one tasks. Chase them.

---

## 9. Verification — run this before you call anything done

- Every route renders with **zero rows** and looks finished. Empty states, never blank panels.
- No screen displays a number that did not come from an API response.
- Four states per screen: loading, empty, error, populated.
- `scrollWidth === clientWidth` at 375 / 414 / 768 / 1024 / 1440.
- `prefers-reduced-motion`: no pinning, no parallax.
- Keyboard: every tab, dropdown, filter pill and table row reachable; focus rings visible.
- A signed-out visitor hitting any `/app/*` route redirects to `/app` and **never flashes content**.
- The buyer page works at 375px on a cold 3G profile.
- 🔴 **The merchant API key appears nowhere in the client bundle.** Verify: `grep -r "Bearer" .next/static/` returns nothing.
- **Not one green pixel.**

> **Testing note:** headless Chrome enforces a ~500px minimum window width, so `--window-size=375` silently renders 500px content into a 375px image and looks like an overflow bug. Test mobile in a 375px `<iframe>` inside a larger window.

---

## 10. Order of work, condensed

1. 🔴 `src/lib/api/types.ts` + `client.ts` → **send `types.ts` to him the same day**
2. The rest of `src/lib/api/`
3. Dash shell: `(dash)/layout.tsx`, `shell.tsx`, `nav.tsx` + auth guard
4. The six primitives — `empty.tsx` and `state-pill.tsx` first
5. 🔴 `/pay/[token]` — the buyer checkout
6. `/app/checkout/new` + `[id]`
7. `/app/activity` + payment detail + recovery actions
8. `/app/home`
9. Settings (settlement + developers)
10. Pay, Links, Earn, Ramps
11. Ask — cut first if short

**Steps 1, 3, 4 and 5 need nothing from the backend.** That is days of real work available to you right now, today, with zero dependency on him.

---

## 11. Out of scope for you

- Any file under `apps/api/**` or `packages/contract/**`.
- The Prisma schema, the poller, webhook delivery, Aurora calls.
- `docker-compose.yml`, backend env vars.
- **Deciding response shapes unilaterally.** Propose in `types.ts`, then agree with him.

---

## 12. Today

1. Send him [BACKEND.md](../backend/BACKEND.md) and tell him to take **Option B** in §3 so your `src/` does not move.
2. Ask him for the two 🔴 blockers: the status enum and the per-chain minimums.
3. Write `src/lib/api/types.ts`, and send it to him the moment it compiles.
4. Then build the shell. It needs nothing from anyone.
