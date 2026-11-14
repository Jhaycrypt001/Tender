# API notes: what was observed, not what the docs promise

## NEAR Intents 1Click (`https://1click.chaindefuser.com`), observed 2026-11-14

- **A dry quote is synchronous and free.** `POST /v0/quote` with `dry: true` answers 201 with the amounts and a time
  estimate, and creates nothing. It works without an API key.
- **A real quote is not idempotent.** The same request sent twice returns two different `depositAddress` values.
  Each is a live address for that quote. A retried real quote therefore leaves an unused address behind. It moves no
  money, and Tender only ever signs a transfer to the address it stored, but it is why Tender does not retry a real quote.
- **There is no testnet.** Quotes and deposit addresses are real. Only sending money to the address spends anything.
- **A quote's 2xx is not a delivery.** The delivery is only known from `GET /v0/status?depositAddress=...`:
  `SUCCESS` delivered; `REFUNDED` or `FAILED` will not be delivered; everything else is still going.
- **An unknown deposit address is a 404** (`Deposit address ... not found`), also before the first deposit is seen. Tender
  reads it as "not started", never as failed.
- **Refusals are all HTTP 400 with `{ "message": "..." }`**, so the cause is only in the text:
  - `recipient is not valid` for a malformed NEAR account;
  - a bare `Internal server error` (still 400) for a well-formed account that does not exist;
  - `Amount is too low for bridge, try at least 438` (base units of the origin asset). At the time, 0.001 USDC
    quoted fine and 0.0001 USDC did not.
- **Rate limit** headers on every reply: `X-RateLimit-Limit-unauth: 1200` per minute without a key.
- **Fee**: without an API key 1Click applies its unauthenticated fee (0.25% per its docs). `X-API-Key` is the key header.
- **Asset ids** are not guessable: Monad USDC is `nep245:v2_1.omni.hot.tg:143_...`, NEAR USDC is `nep141:1720...`. Tender reads
  them from `GET /v0/tokens` (231 assets) and never hard-codes them.

What a timeout means: for a quote, nothing is known to have been created. For status, nothing is known about the
delivery. Both are retried later; neither is ever read as failed.
