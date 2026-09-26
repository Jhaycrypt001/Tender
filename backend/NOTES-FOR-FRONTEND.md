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

## Try every endpoint

**Swagger UI: http://localhost:4000/docs** — every route, with the exact request and response shapes (generated from the same schemas the API validates with). Click **Authorize** and paste a `tk_live_…` key to call merchant routes.

## To connect locally

`frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:4000
TENDER_API_URL=http://localhost:4000
TENDER_API_KEY=<from: npm run merchant:create in backend/>
```
In `backend/`, once: `cp .env.example .env` (add the Aurora key), `npm install`, `npm run setup`. Then run the API (`npm run dev`) and the worker (`npm run dev:worker`), and create your merchant key with `npm run merchant:create -- --name "Demo" --email you@example.com --settlement 0xYourMonadAddress --verified`.
