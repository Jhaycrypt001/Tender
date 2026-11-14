# Paying out to NEAR through NEAR Intents, direct

Added for the NEAR hackathon (branch `near-hackathon`, work dated 2026-11-14). This path is **separate from Aurora**.

## What it is

A merchant can send money from their own wallet to a **NEAR account** (`alice.near`, or a 64-character hex implicit
account). Tender calls NEAR Intents' own 1Click API (`https://1click.chaindefuser.com`) itself: the quote, the one-off
deposit address and the delivery tracking. Aurora is not involved in this path.

Until now NEAR appeared in Tender only as one of the 30 chains Aurora routes internally. Every other payout to another
chain still goes through Aurora (`backend/src/aurora/`), and is unchanged.

## How a payout works

1. **Quote** (`POST /v1/transfers/near-direct/quote`, moves nothing). Tender asks NEAR Intents for a dry quote
   (Monad USDC to NEAR USDC) and says what the recipient would get.
2. **Prepare** (`POST /v1/transfers/near-direct`). Tender asks NEAR Intents for a real quote, which comes with a one-off
   Monad **deposit address**, and returns the EIP-712 typed data the merchant's wallet must sign: an ordinary Monad
   USDC transfer to that address. The wallet is shown the real recipient (the NEAR account).
3. **Submit** (`POST /v1/transfers/near-direct/:id/submit`). The merchant's signature goes in; the relayer submits it
   and pays the gas. NEAR Intents sees the deposit and delivers USDC to the NEAR account.
4. **Status** (`GET /v1/transfers/near-direct/:id`). `lines[].dest.status` is `PENDING` until NEAR Intents reports the
   swap `SUCCESS` (`DELIVERED`), or `REFUNDED` / `FAILED` (`FAILED`). A refund goes back to the merchant's wallet.

## Still non-custodial

Tender never holds the money and cannot move it. Only a signature from the merchant's own wallet authorizes a transfer,
and it names the exact amount, the deposit address and a 15-minute deadline. NEAR Intents' deposit addresses belong to
one quote each and carry a refund address that is the merchant's wallet.

## Where the code is

| What | Where |
| --- | --- |
| The only code that talks to NEAR Intents | `backend/src/near/client.ts`, `types.ts`, `route.ts` |
| The service and routes | `backend/src/services/near-transfer.service.ts`, `backend/src/routes/near-transfers.ts` |
| Live check, moves no money | `npm run near:smoke -- <near-account> <monad-wallet>` |
| Tests | `backend/test/near-client.test.ts`, `backend/test/near-transfer.test.ts` |

It reuses the existing payout pipeline for everything that is the same for every payout: the balance and daily-limit
checks, the signed authorization, the relayer and the Monad confirmation. Three small additive edits make that
possible: `payout-route.ts` (a per-provider token cache, and the amount passed to the mint step),
`transfer.service.ts` (a delivery check that asks NEAR Intents for lines marked `route = "near-intents"`), and a new
nullable column `TransferLine.route`. A line with no route is an Aurora line and behaves exactly as before.

## Configuration

| Variable | Notes |
| --- | --- |
| `NEAR_INTENTS_API_URL` | Default `https://1click.chaindefuser.com`. |
| `NEAR_INTENTS_API_KEY` | Optional. Without one NEAR Intents applies its unauthenticated fee (0.25% at the time of writing). Sent as `X-API-Key`, never logged. |

## Limits, stated plainly

- Recipient asset is USDC on NEAR only; the merchant's settlement asset (USDC or USDT0) is what leaves Monad.
- There is no NEAR testnet at NEAR Intents: the smoke script makes real quotes and a real deposit address, but sends no money.
- The delivery state comes from NEAR Intents' status endpoint, trusted as reported. A state Tender does not know is read as "still going", never as failed.
- A deposit address that NEAR Intents never reports on stays `PENDING` and is checked every 30 minutes for two weeks, then closed as `UNKNOWN` (the same rule as Aurora deliveries).
- NEAR Intents being down is cheap: a status check is one short attempt, and the first failure ends the tick, so Monad transfers are never kept waiting on it. A refused key (`502 near_misconfigured`) is told apart from an outage (`503 near_unavailable`, try again).
- A real quote is never retried (each one makes a new deposit address), and at most 10 payouts may wait for a signature at once.
- The delivery transaction NEAR Intents reports is logged with `cross-chain delivery completed` (`deliveryTx`); it is not stored on the line.
