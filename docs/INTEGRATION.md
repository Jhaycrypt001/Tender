# Wiring the frontend to the backend

For the backend owner. It covers what the frontend already calls, what the backend doesn't serve yet, and the order to close the gaps in. Checked against `backend/src` and `frontend/src` on 2026-09-29.

**Folder rule, unchanged:** you edit `backend/**`, the frontend owner edits `frontend/src/**`. Anything that crosses the seam goes through `backend/contract/schemas.ts` and a note in `backend/NOTES-FOR-FRONTEND.md`. Section 4 lists the frontend changes queued so you don't build around them.

---

## 0. Where things stand

Your API matches `frontend/src/lib/api/types.ts` route for route (`contract.check.ts` passes). One API key against one merchant already works end to end.

The frontend has been built to handle:

- the flat error body `{ error, message, fields? }`
- snake_case fields
- amounts as strings
- `not_configured` when env vars are missing
- 204 responses
- a 15s timeout
- `Idempotency-Key` on invoice create (it sends the `reference`, which matches your `(merchant, reference)` dedupe)

**What stops this being a product anyone can sign up to:**

| # | Gap | Why it blocks |
|---|---|---|
| 1 | **No link between a Google sign-in and a merchant** | The dashboard signs merchants in with Google, but every server call uses the one `TENDER_API_KEY` in env. Right now every person who signs in sees the same merchant's money. |
| 2 | **No API-key endpoints** | Settings → Developers can't issue, list or rotate a merchant's `tk_live_` key. Today a key only comes from `npm run merchant:create`. |
| 3 | **Not deployed** | The checkout page calls `/public/*` straight from the buyer's browser, so the API needs a public HTTPS URL and `CORS_ORIGINS` set to the frontend's domain. |

Fix 1 first. Nothing else matters until two people can sign in and see different accounts.

### Audit, 2026-09-29

- **All 24 calls the frontend makes have a matching backend route**, SSE included. `npm run typecheck` passes, which covers `contract.check.ts` against the current frontend types.
- **The backend tests were not run.** They need Postgres on 5434, and Docker was down on this machine. Run `npm run setup && npm test` and post the result.
- **Chain count doesn't match.** The landing page says "31+ chains". `aurora/chains.ts` offers 7: Bitcoin, Solana, Tron, Ethereum, Base, Arbitrum, Monad. Either add the Aurora chains we can support, or tell the frontend owner the real number so the copy says it. Judges will check.
- **Screens with nothing behind them yet.** Each one says so on screen, and none fakes a result:

| Screen | What the backend has today | What it would need |
|---|---|---|
| Earn | `positions` returns `[]`; `deposit` returns 501 | Aurora Intents Connect into a Monad position |
| Ramps / Cash out | `corridors` returns `[]` | An off-ramp partner |
| Pay → Payout, Pay → Split | nothing | A payout route. It moves real money, so it needs its own design |
| Display currency (EUR, NGN…) | USD only (`display_total`) | A live FX rate source |

For the hackathon, the core flow in §5 matters more than any of these. Leave them honestly empty rather than half-building one.

---

## 1. Link a Google sign-in to a merchant (blocker)

### How the frontend signs people in

`frontend/src/lib/auth.ts` runs Google OAuth itself. After the callback it puts `{ sub, email, name, picture }` into an HMAC-signed cookie (`tender_session`). The backend is never told about it.

### Proposed design: a platform key that acts for one merchant at a time

**1. Add a new backend env var, `TENDER_PLATFORM_KEY`.**
- A random value of at least 32 bytes, with a `tp_` prefix so a leak shows up in a scan.
- Only the dashboard's server has it. It is never sent to a browser and never `NEXT_PUBLIC_`.

**2. Add a Google id to the merchant table.** Add `googleSub String? @unique` to `Merchant`, with a migration.

**3. Add a route to find or create the merchant for a sign-in.**

```
POST /internal/merchants/resolve
Authorization: Bearer <TENDER_PLATFORM_KEY>
{ "google_sub": "1082…", "email": "a@b.com", "name": "Ada" }

200 { "id": "mer_…", ...Merchant }   existing merchant
201 { "id": "mer_…", ...Merchant }   created just now
```

- Upsert on `google_sub`, never on email. Two Google accounts can share an email through aliasing, and a `sub` is permanent.
- A new merchant has no settlement address. That's fine: your `settlement_not_verified` 409 already stops invoices until they verify one, and the dashboard already sends people to Settings for it.
- Merchants made with the `merchant:create` CLI have no `googleSub`. Leave them alone. If you want a way to claim one, do it as a separate, explicit step.

**4. Let the dashboard act for that merchant.** In `requireMerchant` (`src/routes/auth.ts`), accept either of these:
- `Bearer tk_live_…`. The merchant's own server calls this way, unchanged.
- `Bearer <TENDER_PLATFORM_KEY>` plus `X-Tender-Merchant: mer_…`. Only the dashboard server calls this way.

Details for the platform-key path:
- Compare the key in constant time (`crypto.timingSafeEqual`).
- A missing or unknown `X-Tender-Merchant` returns 401, not 404, so the header can't be used to probe which ids exist.
- Log which merchant each platform call acted for.

**5. What the frontend will do on its side:**
- Call `resolve` in `/app/callback`.
- Put the merchant `id` in the signed session cookie. Users can't change it without breaking the HMAC.
- Have `client.ts → request()` send `X-Tender-Merchant` on every call.
- Rename `TENDER_API_KEY` to `TENDER_PLATFORM_KEY`.

**Why not store each merchant's own `tk_live_` key in the cookie instead?**
- Keys are argon2-hashed and shown once, so you can't hand an existing one back.
- A stolen cookie would become an API key that works outside the dashboard.
- Rotating a key would log the merchant out.

With the platform key, the only secret sits on one server. A session only proves who the user is, and it expires.

**Risk to accept knowingly:** `TENDER_PLATFORM_KEY` can act as any merchant. Keep it in exactly two places, the backend env and the frontend server env. Rotate it if either env leaks. Rate-limit it separately from merchant keys.

---

## 2. API keys and the webhook secret (Settings → Developers)

`frontend/src/app/app/(dash)/settings/developers/page.tsx` has a comment noting that the contract has no key endpoints. Suggested routes, all under `requireMerchant`:

```
GET    /v1/merchant/api-keys          200 { data: [{ id, prefix, created_at, last_used_at }] }
POST   /v1/merchant/api-keys          201 { id, key: "tk_live_…", prefix, created_at }   key shown ONCE
DELETE /v1/merchant/api-keys/:id      204   (404 if not this merchant's key)
POST   /v1/merchant/webhook/secret    201 { webhook_secret }                          shown ONCE, replaces the old one
```

- **Store keys in their own table.** Move `apiKeyHash` off `Merchant` into an `ApiKey` table (`merchantId, prefix, hash, createdAt, lastUsedAt, revokedAt`). Rotating then works as create a new key, deploy it, delete the old one, and a merchant's integration never goes down in between.
- Keep your current lookup: narrow by prefix, then check with argon2.
- Update `last_used_at` no more than once a minute per key, so every request doesn't turn into a database write.

Add the shapes to `contract/schemas.ts` and a line to `NOTES-FOR-FRONTEND.md`. The frontend adds the types and the screens.

---

## 3. Deploy

The API and the worker run as **two processes** against one Postgres and one Redis. On Railway, for example, that's two services from the same repo, plus the Postgres and Redis add-ons.

### Backend env (production)

| Var | Value |
|---|---|
| `NODE_ENV` | `production` (turns on `trustProxy`, so per-IP rate limits see the real client IP) |
| `DATABASE_URL`, `REDIS_URL` | managed instances; run `prisma migrate deploy` on release, never `migrate dev` |
| `AURORA_API_KEY` | server only |
| `CORS_ORIGINS` | the exact frontend origin(s), e.g. `https://tender.xyz` (no trailing slash; preview domains too if we test there) |
| `TENDER_PLATFORM_KEY` | new, see §1 |
| `METRICS_TOKEN` | set it: `/metrics` is otherwise public |
| `MONAD_RPC_URL` | defaults to the public RPC; use a paid endpoint for real traffic |

### Frontend env (Vercel), set by the frontend owner

```
NEXT_PUBLIC_API_URL=https://api.<domain>   # the browser uses this: checkout page, SSE, submit-tx
TENDER_API_URL=https://api.<domain>        # the dashboard server uses this; can be a private URL
TENDER_PLATFORM_KEY=tp_…                   # server only
```

### Server-sent events through a proxy

- The checkout page opens `EventSource(NEXT_PUBLIC_API_URL + /public/invoices/:token/events)` straight to your API. Vercel isn't in the path.
- You already send `x-accel-buffering: no` and a ping every 15s.
- Make sure the host's idle timeout is longer than 15s and that the host doesn't gzip or buffer `text/event-stream`.
- Test it on the deployed URL, not just on localhost.

### When `/public/chains` returns 503

It returns 503 for a minute or two after every cold start of the worker. To keep that short, run the minimums measurement once when the worker boots, not only on the 30-minute timer.

---

## 4. Changes queued on the frontend side (don't build around them)

These answer your `NOTES-FOR-FRONTEND.md` plus two issues found while writing this doc.

| # | Change | Status |
|---|---|---|
| 1 | Minimums shown as USD (`$8.45`) | ✅ done (`UsdMinimum` on the checkout) |
| 2 | Show `recovery.notes` on the payment screen | ✅ done (`activity/[id]`) |
| 3 | **Payment links.** `/pay/pl_…` now opens the link instead of 404ing. Details and one small ask below. | ✅ done (`components/pay/open-link.tsx`) |
| 4 | `/public/chains` 503 (`not_ready`) shown as "measuring minimums, try again shortly", not as an error | queued |
| 5 | UNDERPAID wording in `/docs` and on the landing FAQ: use your suggested text | queued |
| 6 | Remove the `tk_test_` sandbox FAQ | queued |
| 7 | Withdraw button: "Withdraw to my address" suggests money moves right away. Rename it to "Request withdrawal" and explain that it files an Aurora support case | queued |
| 8 | Refund `501 not_supported` shown as "not available for this payment", not as a failure | queued |
| 9 | Webhook test result: show `status_code` / `error` | queued |
| 10 | Session → merchant id → `X-Tender-Merchant` header | waiting on §1 |

### Payment links: how the frontend opens them

Your `openLink` is used unchanged. Here is how the page at `/pay/pl_…` behaves, so you know what hits the API:

- **Nothing is sent on page load.** WhatsApp, Telegram, Slack and iMessage fetch a link to draw its preview, and if loading the page opened the link, every chat it was pasted into would leave an unpaid invoice behind. The buyer taps **Continue to payment**, which sends one `POST /public/links/:token`.
- **The POST comes from the buyer's browser, not the Next server.** Your limit of 10 per minute per IP would otherwise apply to all buyers together, because they would all share our server's IP. So **`CORS_ORIGINS` must include the frontend origin** or every link fails (§3).
- The first POST has an empty body `{}`. A `201 {token}` goes to `/pay/chk_…` with `router.replace`, so pressing Back doesn't mint a second invoice. The button stays disabled while the request runs.
- A validation error with `fields.amount` is read as "this is an open-amount link". An amount field appears, and the next POST sends `{"amount":"25.00"}`. **Keep that field name and error shape**, because the page depends on them.
- `404` shows "This payment link is not valid", `429` shows "too many tries from this network", and anything else shows "couldn't open, nothing was taken, try again". A token that doesn't match `^pl_[0-9A-Za-z]{27}$` is rejected before any request is made.

**One small ask, additive and optional:** `GET /public/links/:token → { label, amount | null, currency, merchant_name, active }`. It creates nothing and doesn't count toward `uses`. Today the buyer can't see who they're paying or how much until after the invoice exists, and an open-amount link asks for an amount with no currency next to it. Once this route exists, the frontend will show the merchant name, label and amount before the button. Until then the page works without it.

---

## 5. Aurora: what the judges need to see working

The bounty asks for a working integration, "demoed live, not mocked". Every step below must run against the deployed stack, in the real dashboard, with real money.

1. A **fresh Google account** signs in → a new, empty merchant (proves §1).
2. The merchant sets a Monad settlement address and verifies it: challenge → sign → verify. For a smart-contract wallet, ERC-1271 goes through `MONAD_RPC_URL`.
3. The merchant creates a $5 invoice in the dashboard and opens `/pay/chk_…` on a phone.
4. The buyer pays from **Solana** (not an EVM chain; bonus points for coverage). The checkout flips PENDING → DETECTED → SETTLED live over SSE, with no refresh.
5. The payment shows on Activity; the balance card moves; the webhook fires, and Settings → Developers → Test shows the delivery.
6. **Underpay a second invoice on purpose.** Send less than the chain minimum → it is refunded, the invoice goes UNDERPAID, and the webhook says so. Most teams skip this path, and it's what sets us apart.
7. Open a payment link from a phone, choose an amount, pay (proves §4 item 3).

If Aurora returns `OPERATION_FAILED` at any point during rehearsal, keep that payment. A real NEEDS_RECOVERY with notes on screen proves the recovery path better than anything staged.

---

## 6. Before real merchants

- [ ] Two Google accounts see two different merchants. Account A can't load Account B's `/v1/payments/:id` by id (expect 404).
- [ ] The platform key can't reach any route without `X-Tender-Merchant`.
- [ ] Rate limits are separate for platform-key traffic, per-merchant `tk_live_` traffic, and per-IP `/public/*` traffic.
- [ ] Idempotent create: same `reference` + same body → the original invoice; same `reference` + different amount → 409.
- [ ] Poller: killed mid-run and run twice at once → still one `Payment` per tx hash.
- [ ] Webhooks: dead-letter after N attempts, and the merchant can see failed deliveries. Plan a v2 signature over `timestamp.body` (your own note in `webhook.service.ts`).
- [ ] Alerts on the Aurora error rate, poll lag (oldest `nextPollAt`), webhook dead letters, and chain minimums older than 2× the refresh interval.
- [ ] Daily Postgres backups, with one restore actually tested.
- [ ] `AURORA_API_KEY` and `TENDER_PLATFORM_KEY` appear in no log line and no response. `grep` the logs of a full test run for `tp_` and the Aurora key.
- [ ] Public responses leak nothing: re-check `toPublicInvoice` whenever a field is added to `Invoice`.

---

## 7. How we work across the seam

1. You add or change a route: update `contract/schemas.ts`, run `contract.check.ts`, and add a line to `NOTES-FOR-FRONTEND.md` with the date.
2. The frontend owner updates `frontend/src/lib/api/types.ts` to match and builds the screen.
3. Swagger at `http://localhost:4000/docs` is the reference both sides test against.
4. Neither of us edits the other's folder. If a fix needs both sides, it's two commits, one each.
