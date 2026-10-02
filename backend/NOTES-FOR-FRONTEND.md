# Notes for the frontend owner

From the backend, 2026-09-26. None of these required a change to `types.ts` — the contract check passes — but each affects what a screen shows.

## Please change (small)

1. **Minimums are in USD.** `InvoiceAddress.minimum` and `Chain.minimum` are dollar amounts (e.g. `"8.45"` for Bitcoin), because a buyer may send more than one asset on a chain. The checkout currently prints "Send at least **8.45** on Bitcoin" — please render it as **$8.45**.

2. **`/public/chains` can return `503`** until the worker has measured minimums (a minute or two after first start). The client maps it to `server`; please treat it like "no data yet", not a failure.

## Please decide (wording on /docs)

3. **UNDERPAID is described as "refunded automatically."** That is true of a sub-minimum deposit, but not of a partial payment that settled: e.g. a buyer sends $20 of a $49 invoice, it settles to the merchant, and when the window closes the invoice becomes UNDERPAID — the merchant *has* the $20. Suggested /docs text: *"Less than the amount arrived. A deposit below the chain minimum is refunded automatically; anything above it reached your address — see the invoice's payments."*

4. **Retry / Withdraw.** Aurora's persistent addresses have no retry, withdraw or refund API (the retry/withdraw model is from a different Aurora product). So:
   - **Retry** re-checks Aurora and keeps watching. If Aurora completes the payout, the payment becomes SETTLED and the recovery task RESOLVED.
   - **Withdraw** does not move funds. It records the destination and appends a ready-to-file Aurora support case to `recovery.notes`; the task stays `OPEN`. Please show `recovery.notes` on the payment screen, and don't label the button as if funds move instantly.
   - **Refund** returns `501 not_supported`.
   The `NEEDS_RECOVERY` callout on /docs ("recovery is explicit") should not imply Tender moves the funds itself.

5. **Sandbox.** /docs promises `tk_test_` keys on test chains. They do not exist (Aurora has no testnet for this). Suggest removing that FAQ entry for now.

## Additive — new, optional to use

6. **`POST /public/links/:token`** — a buyer opens a payment link. Body `{ "amount": "5.00" }` only for open-amount links. Returns `201 { "token": "chk_…" }`: redirect to the checkout for that token. Rate-limited to 10/min per IP.

7. **`POST /v1/merchant/webhook/test`** returns `{ delivered, status_code, error?, event_id }`.

8. **Webhook headers.** Besides `X-Tender-Signature`, each attempt carries `X-Tender-Timestamp` (unix seconds) and `X-Tender-Event-Id`. The published scheme signs the body only, so the timestamp header is not covered by the signature — the body's `created_at` is. Worth a line on /docs.

9. **Errors** are flat: `{ "error": "<code>", "message": "…", "fields"?: {…} }`, which `client.ts` already reads. `429` bodies have `error: "rate_limited"`.

## 2026-09-30: Google sign-in to merchant (docs/INTEGRATION.md §1)

10. **`POST /internal/merchants/resolve`** — call it from `/app/callback` with `Authorization: Bearer <TENDER_PLATFORM_KEY>` and `{ "google_sub", "email", "name"? }`. Returns the merchant (same shape as `GET /v1/merchant`): **201** when just created, **200** when it existed. It keys on `google_sub`; a changed email on a known sub is ignored. Put the returned `id` in the signed session cookie.
    - A new merchant has no settlement address: invoice create returns `409` until they verify one in Settings.
    - If the Google email already belongs to another merchant, the new one is stored as `name+<sub>@domain`. Display `name`, not `email`, where it matters.

11. **Acting for that merchant.** Every `/v1/*` call from the dashboard server sends `Authorization: Bearer <TENDER_PLATFORM_KEY>` **and** `X-Tender-Merchant: <id>`. A missing or unknown id is `401`, not `404`. `tk_live_` keys keep working exactly as before. This replaces `TENDER_API_KEY` in the dashboard server env (rename it to `TENDER_PLATFORM_KEY`).
    - The platform key is **server-only**: never `NEXT_PUBLIC_`, never in a browser bundle. It has a `tp_` prefix and is 46+ characters.
    - Generate one: `node -e "console.log('tp_'+require('crypto').randomBytes(32).toString('base64url'))"`, and set the same value in the API env and the dashboard server env.
    - Platform traffic is rate-limited per merchant it acts for (1200/min), separately from `tk_live_` keys.
    - Browser-called routes (`/public/*`) are unchanged and need no key.

12. **API keys (Settings → Developers).** All under the merchant scope (a `tk_live_` key, or the platform key + `X-Tender-Merchant`):
    - `GET /v1/merchant/api-keys` → `{ data: [{ id, prefix, created_at, last_used_at|null }] }`. Prefix only, never the key.
    - `POST /v1/merchant/api-keys` → `201 { id, key, prefix, created_at }`. **`key` is shown once**: render it in a copy-once dialog. Max 10 active keys (`409` beyond that).
    - `DELETE /v1/merchant/api-keys/:id` → `204`; `404` if it is not this merchant's. Takes effect at once, so warn before revoking the key the user is currently using elsewhere.
    - `POST /v1/merchant/webhook/secret` → `201 { webhook_secret }`, **shown once**, replaces the old secret immediately.
    - A merchant created through Google sign-in starts with **no keys**; the empty state should say so.
    Shapes are in `backend/contract/schemas.ts` (`ApiKeySummary`, `ApiKeyList`, `CreatedApiKey`, `RotatedWebhookSecret`) and Swagger. They have no counterpart in `types.ts` yet: please add them.

13. **`GET /public/links/:token`** → `{ label, amount|null, currency, merchant_name, active }`. Creates nothing, does not count as a use, no auth, shares the ordinary public rate limit (not the 10/min open limit). `amount` is `null` for open-amount links, so show the amount input with `currency` next to it. An inactive link returns `200` with `active: false` (say "this link was turned off"); a malformed or unknown token is `404`. `POST /public/links/:token` is unchanged, including the `fields.amount` error.

14. **`GET /v1/merchant/webhook/deliveries?status=&limit=`** → `{ data: [{ id, event, invoice_id, status, attempts, last_error|null, next_retry_at|null, delivered_at|null, created_at }] }`, newest first. `status` is `delivered`, `retrying` (attempts left) or `failed` (every retry used; never sent again). `?status=failed` lists the events the merchant's server never received: a good "Failed deliveries" panel under Settings → Developers. `limit` 1–100, default 25. No payload or secret is returned. Shapes: `WebhookDelivery`, `WebhookDeliveryList` in `contract/schemas.ts`.

15. **30 chains are live in the backend** (2026-09-30). Ids match `frontend/src/lib/chains.ts` exactly (a test checks this). Two things change what you see:
    - **Default chains are 17, not 7**: every EVM chain plus Bitcoin, Solana and Tron. The other 13 (NEAR, Sui, Aptos, TON, XRP, Cardano, Dogecoin, Litecoin, Bitcoin Cash, Zcash, Starknet, Aleo, Dash) are **opt-in per invoice** through `chains`, because each costs its own Aurora call. The create-invoice form should let the merchant tick them; it already offers whatever `/public/chains` returns.
    - **`/public/chains` only lists chains whose minimum has been measured.** Right now it is empty (503): Monad as a destination is under maintenance on Aurora's side, so every dry quote fails ("Quoting for this pair is not available"), from every origin. (On 2026-09-30 it looked Solana-specific; that was the start of the same maintenance.) It fills in on its own when Aurora restores Monad. A full measurement takes 7–13 minutes, but on a cold start `/public/chains` now fills in chain by chain instead of 503 for the whole run. **Until Monad is back, the create-invoice form has no chains to offer from `/public/chains`.**

16. **Webhook signature v2** (additive, v1 is unchanged). Every delivery now carries `X-Tender-Signature-V2: sha256=<hex hmac-sha256 of "<timestamp>.<raw body>">`, where `<timestamp>` is the `X-Tender-Timestamp` header (unix seconds, of that attempt), next to the existing `X-Tender-Signature`. v1 signs the body only, so its timestamp can be altered or replayed; v2 covers it. Please show the v2 verifier on `/docs` and say a delivery older than 5 minutes should be rejected. Reference implementation: `verifyWebhookV2` in `backend/src/lib/crypto.ts`. In Node:

    ```js
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
    const sameLength = sigHeader.length === expected.length;
    const ok = fresh && sameLength && crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    ```

    Each retry is re-signed with its own timestamp, so a retried event verifies normally.

## Try every endpoint

**Swagger UI: http://localhost:4000/docs** — every route, with the exact request and response shapes (generated from the same schemas the API validates with). Click **Authorize** and paste a `tk_live_…` key to call merchant routes.

## To connect locally

`frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
TENDER_API_URL=http://localhost:4000
TENDER_PLATFORM_KEY=<the same tp_… value as in backend/.env>
```
(`TENDER_API_KEY` from `npm run merchant:create` still works as a single fixed merchant until the dashboard switches to the platform key.)
In `backend/`, once: `cp .env.example .env` (add the Aurora key), `npm install`, `npm run setup`. Then run the API (`npm run dev`) and the worker (`npm run dev:worker`), and create your merchant key with `npm run merchant:create -- --name "Demo" --email you@example.com --settlement 0xYourMonadAddress --verified`.
