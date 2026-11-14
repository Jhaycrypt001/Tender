# Deploying the Tender API

One image, two processes, one Postgres, one Redis. `backend/Dockerfile` builds it; it was built and smoke-tested locally (API, worker, release migration) on 2026-09-30.

| Service | Command | Notes |
|---|---|---|
| **api** | `npm start` (the image default) | HTTP on `$PORT` (default 4000). Needs a public HTTPS URL. |
| **worker** | `npm run worker` | No public port. Poller, webhook delivery, minimums measurement. Serves its own `/metrics` on `WORKER_METRICS_PORT` (9464). |
| **release** | `npx prisma migrate deploy` | Run once per release, **before** the new api/worker start. Never `migrate dev` in production. |

Run exactly **one** worker replica until the poller's at-least-once guarantee has been load-tested at scale. The API can scale horizontally.

## Environment

Set these on **both** api and worker unless noted.

| Var | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Turns on `trustProxy`, so per-IP rate limits see the real client IP. Set on api. |
| `DATABASE_URL` | managed Postgres | |
| `REDIS_URL` | managed Redis | Rate limits, SSE fan-out and the minimums cache all live here. |
| `AURORA_API_KEY` | from studio.aurora.dev | Server only. **The key must have persistent deposit addresses enabled**, see "Aurora key" below. |
| `TENDER_PLATFORM_KEY` | `tp_` + 32 random bytes, base64url | **api only.** Generate with `node -e "console.log('tp_'+require('crypto').randomBytes(32).toString('base64url'))"`. Acts as any merchant: the same value goes in the dashboard server's env and nowhere else. |
| `CORS_ORIGINS` | the exact frontend origin(s), e.g. `https://tenderr.xyz` | No trailing slash. Include preview domains only if you test on them. **Payment links and checkout fail in the browser without it.** api only. |
| `METRICS_TOKEN` | 16+ random characters | `/metrics` is public without it. Set on api and worker. |
| `RELAYER_PRIVATE_KEY` | `0x` + 64 hex | **api only.** The wallet that submits merchants' signed transfers and pays their gas in MON. Fund it with a few MON and nothing else; the merchant's own wallet authorizes every transfer, so this key cannot move merchant funds. Without it `/v1/transfers` answers 503. |
| `RELAYER_MIN_MON` | default 0.02 | Transfers pause (503) when the relayer holds less than this. Alert before it gets there. |
| `NEAR_INTENTS_API_URL` | default https://1click.chaindefuser.com | NEAR Intents, used directly for payouts to NEAR accounts. |
| `NEAR_INTENTS_API_KEY` | optional | Without it NEAR Intents applies its unauthenticated fee. Never logged. See docs/NEAR-INTENTS.md. |
| `MONAD_RPC_URL` | a paid endpoint | Only used to verify smart-contract settlement wallets (ERC-1271). The public default is fine for a demo. |
| `MINIMUMS_REFRESH_MINUTES` | default 30 | See "Minimums" below. worker only. |
| `MINIMUM_MARGIN_BPS` | default 2000 | Safety margin added to measured per-chain minimums. worker only. |
| `POLL_INTERVAL_MS` | default 10000 | How often an open invoice's addresses are polled. Aurora throttles the key; do not go lower. worker only. |
| `POLL_CLOSED_INTERVAL_MS` | default 60000 | Late-payment watch on closed invoices. worker only. |
| `POLL_CONCURRENCY` / `POLL_BATCH_SIZE` | defaults 4 / 200 | Parallel polls, and addresses taken per tick. worker only. |
| `INVOICE_TTL_MINUTES` | default 30 | How long a new invoice stays payable. api. |
| `EXPIRY_GRACE_MINUTES` | default 15 | How long after the deadline an in-flight deposit still counts. worker. |
| `LATE_WINDOW_HOURS` | default 24 | How long closed invoices are still watched for late or extra money. worker. |
| `PAYMENT_TOLERANCE_BPS` | default 100 | A payment within this many basis points of the amount counts as exact. worker. |
| `TRANSFER_DAILY_LIMIT` / `TRANSFER_MAX_LINES` | defaults 100 / 10 | Per-merchant transfers per 24 hours (enforced at submit), and lines per transfer. api. |
| `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_REPLY_TO` | optional | Transactional email. Without the key nothing is sent. worker. |
| `GEMINI_API_KEY` / `ASSISTANT_MODEL` / `ASSISTANT_FALLBACK_MODEL` | optional | The assistant. Without the key it is off. Model defaults: `gemini-3.1-flash-lite`, then `gemini-3.5-flash-lite`. api. |

The server refuses to boot on a missing or malformed value (`src/config.ts`), so a bad deploy fails at start, not mid-request.

### Frontend env (set by the frontend owner)

```
NEXT_PUBLIC_API_URL=https://api.<domain>   # the browser: checkout, SSE, submit-tx, payment links
TENDER_API_URL=https://api.<domain>        # the dashboard server; can be a private URL
TENDER_PLATFORM_KEY=tp_…                   # server only, same value as the api's
```

## Release steps

1. Build and push the image.
2. Run the **release** command against the production database.
3. Start or roll the **api** and **worker**.
4. `curl https://api.<domain>/health` returns `{"status":"ok","database":"ok","redis":"ok"}`.
5. `curl -i https://api.<domain>/metrics` returns **401** (and 200 with the token).

## Aurora key

`POST /api/persistent-deposit-address` returned

```
403: Persistent deposit address creation is not enabled for this API key
```

for every chain on 2026-09-30 (~18:20 UTC), for any sender not minted before. Probe addresses minted earlier in the same session still returned. Until the key can create addresses, **every `POST /v1/invoices` for a new invoice fails**. Confirm before any demo:

```
npm run aurora:smoke -- <monad-address> <a-sender-string-you-have-never-used>
```

If it 403s, the key needs persistent-address access enabled in studio.aurora.dev (or from Aurora), and nothing in this repo can work around it.

## Rate limits and the client IP

The per-IP limits use `X-Forwarded-For` (`trustProxy` is on in production). That is only safe if the host's edge overwrites a client-supplied header. **Verified on Railway, 2026-11-11:** 14 POSTs to `/public/links/:token`, each with a different spoofed `X-Forwarded-For`, were limited after 10 exactly like unspoofed ones. **Repeat this check before moving to another host or putting a CDN in front:** send 14 POSTs to `/public/links/pl_AAAAAAAAAAAAAAAAAAAAAAAAAAA` with a different `X-Forwarded-For` each; the last four must answer 429.

## Invoice creation latency

Each invoice mints its deposit addresses **one chain family at a time**. Aurora answers `429 A concurrent request is creating this deposit address` to concurrent mints for the same sender, and minting in parallel made some invoices fail with a 502 (seen live on 2026-10-02). Measured against real Aurora: about 3 seconds for the default 17 chains (4 families), and more for opt-in chains, since each non-EVM chain is its own family at roughly 0.7s. Keep the host's request timeout above 30 seconds.

`npm run e2e:local` runs the whole merchant flow against a running local API and worker and the real Aurora API (see the header of `scripts/e2e-local.ts`). It moves no money.

## Server-sent events through a proxy

The checkout opens `EventSource(NEXT_PUBLIC_API_URL + /public/invoices/:token/events)` straight to the api. The api sends `x-accel-buffering: no` and a comment ping every 15s. On the host:

- idle timeout must be **longer than 15s** (60s+ is comfortable),
- do not gzip or buffer `text/event-stream`,
- test on the deployed URL, not only localhost: `curl -N https://api.<domain>/public/invoices/<chk_token>/events` should print a status event at once and a ping every 15s.

## Minimums

The worker measures each chain's minimum deposit with dry quotes and caches it in Redis for 3 hours. Measured live on 2026-09-30 with all 30 chains:

- **A full run takes roughly 7 to 13 minutes** (764s in the run that included network retries), not 2 to 3. Keep `MINIMUMS_REFRESH_MINUTES` at 30 or more.
- **Cold start:** with nothing cached, the worker publishes each chain as it is measured, so `/public/chains` answers after the first chain instead of 503 for the whole run. With a previous catalogue in place it is left untouched until the new one is complete.
- A failure on one chain costs only that chain: it is retried once, then left out (logged as `measuring a chain failed`). It is never given a guessed minimum.
- The worker needs at least one merchant with a **verified** settlement address to get a recipient for dry quotes. On a fresh database it logs `no verified merchant yet` and measures nothing until one exists, so verify a settlement address first.
- `npm run aurora:measure -- <monad-address> [chain-id …]` runs the same measurement by hand and prints the table. It writes nothing.

As of 2026-09-30, **Solana cannot be measured**: Aurora answers `Quoting for this pair is not available` for Solana to every Monad asset (SOL and USDC to MON, USDT0 and USDC). Solana then drops out of `/public/chains`, correctly. Re-check with `npm run aurora:measure -- <addr> solana` before any demo that pays from Solana.

## Alerts worth wiring (Prometheus)

api `/metrics` and worker `/metrics` are separate processes. Watch:

- **`tender_poll_lag_seconds`** (worker): how overdue the most overdue open address is. Alert if above about 60 for a few minutes.
- **`tender_poll_stale_seconds`** (worker): longest time since an open address was last polled SUCCESSFULLY. Poll lag cannot see an Aurora outage, because back-off pushes the next poll into the future and the lag reads 0; this one grows. Alert above about 300.
- **`tender_poll_failing_addresses`** (worker): open addresses whose last 5 or more polls failed. Each keeps its invoice pending (an invoice is never closed as unpaid while it cannot be checked). Alert above 0 for a while.
- **`tender_webhook_dead_letters`** (worker): deliveries given up on. Alert above 0.
- **`tender_chain_minimums_age_seconds`** (worker): age of the cached minimums, -1 if none. Alert above 2x `MINIMUMS_REFRESH_MINUTES` (in seconds).
- **`tender_aurora_request_seconds{outcome}`**: Aurora error rate. Also watch the log line `aurora rejected the API key: check its permissions`, which means a 401/403 that no retry will fix.
- **`tender_http_request_seconds{route="/v1/invoices",status=~"5.."}`** (api): 5xx on invoice create.

## Backups

Daily Postgres backups, and **restore one** before relying on them. This repo does not configure backups: it is the database host's job.
