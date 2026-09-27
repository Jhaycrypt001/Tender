# Tender — Demo Script

The live demo for the Metropolis hackathon (Aurora Intents × Monad bounty). It follows BACKEND.md §13, corrected for what Aurora actually does (verified live, 26 September 2026).

**The bounty judges a live, non-mocked integration.** Every beat below uses real Aurora and real funds. Nothing is staged.

---

## Before the demo

**The day before**

- [ ] API and worker running where judges can reach them (`npm run dev`, `npm run dev:worker`, or the deployed URL).
- [ ] `GET /health` → `{"status":"ok",…}`.
- [ ] `GET /public/chains` returns measured minimums. If it is `503`, the worker has not measured yet — start it earlier.
- [ ] A merchant with a **verified** settlement address that holds **zero MON** (beat 4 depends on it). Check the balance on a Monad explorer.
- [ ] The merchant's `webhook_url` points at an endpoint you can show on screen (e.g. a webhook.site URL). `POST /v1/merchant/webhook/test` → `delivered: true`.
- [ ] A phone with a Solana wallet holding at least $10 of SOL or USDC.
- [ ] Swagger UI open at `/docs`, authorised with the merchant key, as a fallback for any screen.

**Timing.** Solana settles in about a minute; Bitcoin in about 13. Use **Solana** for the live beats. Aurora has slow spells (seen three times on 26 September). Invoice creation allows 30 seconds per address mint; if a create returns `502`, just retry it — nothing was written.

---

## The beats

### 1. Merchant creates a $49 invoice — four chains offered

Dashboard → Checkout → New, or Swagger `POST /v1/invoices`:

```json
{ "amount_expected": "49.00", "currency": "USD", "reference": "demo_001", "chains": ["solana", "base", "bitcoin", "tron"] }
```

> *"One call. Tender asks Aurora for a deposit address on each chain family — Base, Arbitrum, Ethereum and Monad share one EVM address; Bitcoin, Solana and Tron each get their own."*

Point at `minimum` on each address: **"$8.45 on Bitcoin, $0.41 on Solana. Aurora doesn't publish minimums, so Tender measures them live from Aurora's own quotes."**

### 2. Open the pay link on a phone — no wallet connect, no network picker, no account

Open `/pay/<token>` on the phone.

> *"The buyer never connects a wallet. Tender passes the invoice id to Aurora as the sender, so every invoice gets its own addresses, and a plain transfer is all it takes."*

### 3. Pay from Solana — the page updates by itself

Send **$49 of SOL** (or USDC) to the Solana address. Keep the phone and the dashboard both visible.

The page goes **Waiting → Detected → Paid** with no refresh.

> *"Aurora has no webhooks, so Tender polls it every five seconds and pushes each change to the page over server-sent events."*

### 4. Dashboard: settled on Monad, in USDC — the merchant never touched MON

Show the payment on the dashboard, then the settlement address on a Monad explorer: USDC arrived, and the address still holds **zero MON**.

> *"Paid in SOL on Solana, settled in USDC on Monad. The merchant needs no MON — gas is abstracted end to end."*

Note on amounts: the dashboard's `amount_settled` is slightly below $49 — Aurora's fee and the swap spread come out of what the merchant receives, as with a card. The invoice is judged on what the buyer sent.

### 5. Show the webhook that fired

Show the receiving endpoint: an `invoice.settled` event, with an `X-Tender-Signature` header.

> *"Every state change is a signed webhook. It's written in the same database transaction as the status change itself, so a settled invoice can never lose its webhook — even if a server crashes at the wrong moment."*

### 6. Deliberately underpay a second invoice

Create a $49 invoice and send **less than the Solana minimum** (e.g. $0.20).

> ⚠️ **Rehearse this beat before the demo.** It has not yet been run against real funds: it is not yet confirmed whether Aurora lists a sub-minimum deposit at all before refunding it. Say only what the rehearsal showed.

If the rehearsal confirms the refund, the line is:

> *"Below the chain minimum, Aurora refunds the buyer automatically. Tender showed that minimum before they sent — that's the support ticket we just avoided."*

### 7. Show a `NEEDS_RECOVERY` payment

> ⚠️ **Corrected from BACKEND.md.** The original line — *"Aurora auto-refunds deposit-stage failures but not post-deposit ones, so we model both"* — and any claim that Tender **retries or withdraws the funds itself** must NOT be used. That behaviour belongs to a different Aurora product; the persistent deposit addresses Tender uses have no retry, withdraw or refund API.

A post-deposit failure cannot be triggered on demand, so show this from a real one if it has occurred, or walk through it in the test suite (`test/recovery.test.ts`) and Swagger.

The accurate line:

> *"Most integrations collapse every failure into 'payment failed'. Tender separates a payout that failed **after** the deposit landed: it gets its own state, a recovery task the merchant can see, and Tender keeps watching for Aurora to complete it. If it doesn't, the merchant gets a ready-to-file Aurora support case with the transaction hash and deposit address already filled in."*

### 8. Connect / Earn — skip

Not built: Aurora's deposit Custom Actions are marked *coming soon*. Do not show the Earn tab as working.

### 9. Bonus coverage — one invoice, three chain families

On a single invoice, point out the Bitcoin, Solana and EVM addresses side by side. Paying all three live is optional — Bitcoin takes about 13 minutes.

---

## Questions judges are likely to ask

**"What stops someone changing the settlement address?"**
Changing it clears verification. No invoice can route to the new address until the merchant signs a one-time challenge with that wallet — proof of control, not just a login. A stolen session cannot redirect payments.

**"What if Aurora is down?"**
The poller backs off per address and keeps every state in Postgres. An invoice is never expired while Aurora cannot be reached, because expiry only happens after every address has been polled successfully past the deadline.

**"What if the poller runs twice?"**
It is idempotent and safe to run concurrently: a unique constraint on the deposit's transaction hash, and a row lock per invoice. Both are covered by tests.

**"How are late payments handled?"**
A deposit reaching Aurora up to 15 minutes after the deadline still counts. Later money is recorded on the invoice without reopening it, so the merchant sees it and decides.

**"Do you hold funds?"**
No. Aurora routes directly to the merchant's own address. Tender never has custody.
