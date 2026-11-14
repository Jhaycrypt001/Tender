# Known limitations

What Tender does not do, or does with a catch. Written for anyone who has to run it, review it, or trust it with money.
Each item says what happens, so an operator is not surprised.

## It depends on Aurora, and Aurora's lists are the only record

- Tender never sees a buyer's deposit directly. It reads Aurora's per-address `received`, `success` and `failed` lists.
  If Aurora takes a deposit and never lists it, or lists it and never pays it out, Tender cannot know. The poller reports
  a deposit that has waited too long for a payout, and `POST /internal/payments/:id/resolve` (operator only) closes one
  that Aurora's support settled by hand.
- A payout is matched to its deposit by shared transaction hash, then by value, then by "the oldest waiting deposit".
  A **failed** payout that can only be matched by that last guess is not applied. It is logged once
  (`a failed payout could belong to any of several waiting deposits`) and needs a manual look. There is no tool for
  that yet; the log line is the alert.
- Aurora's `/persistent-deposit-status` calls fail intermittently (`kind=network`). An address that cannot be polled is
  retried with back-off and shows up in `tender_poll_stale_seconds` and `tender_poll_failing_addresses`.

## Invoices close only on evidence

- An unpaid invoice is closed only after a **successful** poll of every address made after its window ended. An Aurora
  outage therefore delays expiry; it can never expire an invoice that was paid.
- Money that arrives after an invoice closed is recorded, the merchant gets an `invoice.late_payment` webhook, and the
  invoice **stays** EXPIRED/CANCELLED. Tender does not reopen it. If an in-time deposit is only listed later and covers
  the amount, the invoice is corrected to SETTLED.
- A payout Aurora lists without any matching deposit is saved as a payment with `fromChain: "unknown"` and
  `auroraTxHash: "payout:<hash>"`, and logged at error level.

## Transfers (payouts, refunds, splits)

- One relayer wallet pays gas for every transfer. It holds only MON, and can do one thing: submit an authorization the
  merchant's own wallet signed. When its balance is low, sending is refused and a warning is logged.
- The relayer's sends run one at a time inside the API process. Running a second API instance would need a shared nonce
  strategy first.
- A send whose broadcast outcome is unknown stays SUBMITTED until reconciliation reads the nonces on-chain. A transfer
  that was never mined is failed once its signatures expire.
- A cross-chain delivery (the second leg, carried by Aurora) that Aurora never reports on is marked `UNKNOWN` after
  14 days. UNKNOWN is not FAILED: the money may or may not have arrived, and only Aurora can say. The log line carries
  the deposit address and the Aurora sender id needed to ask.
- The daily transfer limit is per merchant, over 24 hours, counted when a transfer is submitted.

## Operations

- Rate limits use the client IP the host reports. On Railway a spoofed `X-Forwarded-For` was tested and did not bypass
  the limit. Re-check after changing hosts (see `backend/docs/DEPLOY.md`).
- Webhooks are at-least-once with 8 attempts. A delivery that used them all can be re-sent with
  `POST /v1/merchant/webhook/deliveries/:id/redeliver`. The dashboard has no button for it yet.
- A single Postgres and a single Redis. Backups are taken by hand. Redis holds only caches, the live stream and rate
  limits; losing it loses nothing that is not rebuilt.
- Retried creates are safe through `reference` or an `Idempotency-Key` header. A create with neither is a new invoice.

## Not built yet

- Off-ramp (cash-out) is on the `offramp-ramp` branch, not live: it waits for a production key from Ramp Network, and
  for payout countries to be confirmed.
- No CI. Backend tests need Postgres and Redis (`docker compose up -d --wait`). The frontend has no tests.

## Payouts to NEAR (NEAR Intents, direct)

- The recipient receives **USDC on NEAR** only. The merchant's settlement asset (USDC or USDT0) is what leaves Monad.
- NEAR Intents has **no testnet**. Every live check is mainnet; the smoke script makes real quotes and deposit addresses and
  sends nothing. The automated tests fake NEAR Intents and Monad.
- A **real quote is not idempotent**: each one makes a new deposit address, so Tender never retries one. A prepare whose
  reply was lost leaves an unused address behind; Tender only ever signs to the address it stored.
- At most **10 NEAR payouts may wait for a signature** at once per merchant; each holds a live deposit address.
- Without a NEAR Intents API key, its unauthenticated fee applies (`NEAR_INTENTS_API_KEY` is optional).
- Delivery is read from NEAR Intents' status endpoint and trusted as reported. A state Tender does not recognise is read as
  "still going". A delivery NEAR Intents never reports on is closed as `UNKNOWN` after 14 days, like an Aurora one.
- The delivery's NEAR transaction hash is **logged** (`deliveryTx` on "cross-chain delivery completed"), not stored on the line.
- NEAR payouts share the transfer daily limit and the relayer's gas budget with every other transfer.
