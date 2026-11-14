# Threat model

Short, and limited to what was checked in the code. Where something was not assessed, it says so.

## What is being protected

1. **Merchant funds.** Buyers' payments settle straight into the merchant's own wallet (non-custodial). Tender never
   holds them. The thing to protect is that they go to the **right wallet**.
2. **The relayer key.** It pays gas for transfers. It holds only MON.
3. **Merchant API keys and the platform key.** The platform key acts for any merchant on the internal routes.
4. **Aurora, Gemini, Resend and Railway/Vercel credentials.**

## Who could attack

| Actor | Wants | Main controls |
| --- | --- | --- |
| A buyer | Pay less, or get goods unpaid | The invoice is judged on what Aurora actually paid out, within a tolerance, never on a buyer's claim. A transaction hash a buyer submits is only an accelerator; the poller finds the payment itself. |
| Someone who steals a merchant API key | Redirect money, or send it away | Keys are stored hashed. A new settlement address clears `settlementVerified` and cannot be used until the merchant proves control of it by signing a challenge. **Gap:** nothing tells the old address or imposes a delay (see below). Sending funds needs a signature from the merchant's own wallet, which the API key alone cannot produce. |
| Someone abusing the relayer | Drain its MON, or move money | It can only submit an authorization the merchant's wallet signed, naming the recipient, amount and deadline. Every transfer is simulated before it is sent. A per-merchant daily limit bounds the gas cost. |
| A malicious webhook receiver or a forged webhook | Fake a payment | Webhooks are signed per merchant. Merchants must verify the signature; Tender's own state never comes from a webhook. |
| An anonymous visitor | Scrape or exhaust the API | Rate limits per client IP, with a fail-open limiter so a Redis outage cannot take the API down. Checkout tokens are 160-bit and unguessable; invoice ids are never in a buyer URL. |

## Known gaps

- **Settlement address change has no second factor.** An attacker holding a merchant's session or API key and a wallet of
  their own can point new invoices at it. Invoices already created keep their original address. Options under
  consideration: email the previous contact before it takes effect, and a short cool-down.
- **Operator routes** (`/internal/*`) rest on one shared platform key. It is held in Railway and Vercel and must be
  rotated in both together.
- **Aurora is trusted** for what it reports. A wrong list from Aurora is a wrong invoice status. Tender logs every case
  it can detect (a payout without a deposit, an unreadable entry, an ambiguous match) and does not guess on failures.
- Not assessed: the Privy embedded-wallet export flow, the frontend's content security policy, dependency vulnerability
  scanning.

## Secrets

Keys are read from the environment only, never logged, and never part of a URL Tender logs. Rotate on any suspicion:
relayer key, `TENDER_PLATFORM_KEY` (Railway and Vercel together), database and Redis passwords, and the Aurora, Gemini
and Resend keys.
