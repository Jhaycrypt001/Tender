# Logging

Structured JSON (pino). Every line has `msg`, `level` and the fields below, so a payment can be traced from the logs alone. Secrets are never logged: no API keys (at most the first 12 characters of a refused key), no signatures, no webhook URLs beyond their host.

Level numbers: `30` info, `40` warn, `50` error. Railway's log search takes `@level:error` and `"message text"` filters.

## Alert on these

| Message | Level | Means | Act |
|---|---|---|---|
| `relayer is below its minimum: sends are PAUSED until it is topped up` | error | The gas wallet is empty. Every payout, refund and split is refused with a 503. | Top up the `relayer` address in the line with MON. |
| `relayer balance is low: it will pause sends soon` | warn | Under twice the minimum. | Top up soon. |
| `deposit received by Aurora but not paid out yet` | warn | Aurora took a deposit and has neither paid it out nor failed it for 10+ minutes. Repeats every 15 minutes for the first day, then once a day. | Check the deposit at Aurora; open a support case with `tx`, `addressId` and `invoiceId`. |
| `deposit from a chain Tender does not list` | warn | A deposit arrived from a chain Tender cannot take payment from (for example `hood`). The money is real and is probably stuck. | Contact the merchant; open an Aurora case. |
| `deposit origin chain unknown` | warn | Aurora named no origin chain and the asset id carries none. | Look the `tx` up by hand to see which chain it came from. |
| `cross-chain delivery is late` | warn | A send to another chain was confirmed on Monad but not delivered after 10+ minutes. Every 15 minutes for the first day, then once a day. | Check `depositAddress` at Aurora. |
| `cross-chain delivery failed at Aurora` | warn | Aurora reported the delivery failed. | Support case; the merchant sees "Not delivered". |
| `request failed` | error | An API request ended in a 5xx. | Look at `route` and the error logged just before it. |
| `slow request` | warn | An API request took over 3 seconds (live-update streams excluded). | Look at `route` and `ms`. |
| `transfer send outcome unknown; reconciliation will settle it` | error | A relayed send may or may not have been broadcast. | Watch for `transfer confirmed on Monad` or `transfer failed` for the same `transferId`. |
| `authentication refused` | warn | A bad key or platform credential. One line per caller and reason every 30 seconds; `count` is how many refusals it stands for. A high `count` is probing. | Look at `reason`, `ip`, `keyPrefix`, `count`. |
| `rate limit exceeded` | warn | A caller hit its limit (one line per caller per 30 seconds). | Look at `group` and `ip`. |

## Tracing a payment

| Question | Search for | Message |
|---|---|---|
| Whose address is this? | the address | `deposit address minted` (has `sender`: the invoice id, `standing:<merchant id>` or `payout:<uuid>`), `standing deposit address created` |
| Did Tender see the deposit? | the `tx` hash | `deposit recorded` (chain, asset, amount, USD value, sender, recipient, Aurora intents account) |
| Did it pay out? | the `invoiceId` or `tx` | `deposit payout outcome recorded`, `invoice transition` |
| Where is a transfer? | the `transferId` | `transfer prepared` → `transfer submitted to Monad` → `transfer confirmed on Monad` or `transfer failed`; for another chain, `cross-chain delivery completed` |
| Why was a send refused? | the merchant id | `payout route refused` (`stage`, `field`, `reason`) |
| Who changed a setting? | the merchant id | `merchant settings updated`, `api key created`, `api key revoked`, `webhook secret rotated` |
| Who asked for recovery? | the `paymentId` | `payment recovery requested`, `payment withdrawal case prepared` |
| Was it closed by hand? | the `paymentId` | `payment resolved manually` (`outcome`, `proofTx`, `note`) |

## Keeping the volume down

The backend runs on limited resources, so it logs events and problems, not routine activity:

- **No line per API request.** Fastify's two lines per request are off. Request counts and timings are in `/metrics`; only `request failed` (5xx) and `slow request` (over 3 seconds) are logged.
- **`poller tick`** is logged only when something changed, plus one heartbeat every 15 minutes. Quiet ticks are debug.
- **`platform call acting for merchant`** (every dashboard request) is debug.
- **Repeats are throttled:** refused sign-ins and rate-limit blocks once per caller per 30 seconds, stuck deposits and late deliveries every 15 minutes for the first day and then daily, relayer warnings once a minute.

Set `LOG_LEVEL=debug` for a while to see the routine lines when debugging.

## How long things are watched

| What (defaults; `POLL_INTERVAL_MS`, `POLL_CLOSED_INTERVAL_MS`, `LATE_WINDOW_HOURS` change the first three) | Cadence | Stops |
|---|---|---|
| Open invoice address | every 10 seconds | when the invoice closes |
| Closed invoice (late money) | every minute | 24 hours after it closes |
| Address holding a deposit Aurora has not paid out or failed | every 30 minutes for the first week, then every 6 hours | 30 days after the deposit, or when Aurora resolves it |
| Payout check (Aurora's success and failed lists) for a deposit waiting over a day | every 30 minutes, even on an address polled every minute (new money is still looked for on every poll) | when the payment resolves |
| Standing deposit address | every minute | never |
| Cross-chain delivery | every 30 seconds for the first day, then every 30 minutes | 14 days after the Monad send |

After those cut-offs the item is a support case: the stuck-deposit warning keeps repeating daily so it is not forgotten.

## Other lines

- `poller tick`: counts only (`polled`, `transitions`, `expired`, `ms`). See above for when it is written.
- `address polled` (debug, off by default): per-address received/success/failed counts. Set `LOG_LEVEL=debug` to see it.
- `invoice created` (from the API, or with `via: "payment link"` when a buyer opens a link), `invoice create replayed (same reference)`, `invoice cancelled`.
- `payment link created`, `buyer submitted a transaction hash`.
- `webhook attempt failed`, `webhook gave up after final attempt` (error), `email attempt failed`, `email gave up`.
- `deposit recorded without a USD value`, `no USD price for deposit asset`.
- `deposit address mint failed`, `aurora request failed`.

## Closing a payment Aurora resolved by hand

When Aurora's support team refunds a sender or delivers to a merchant outside the normal flow, the deposit never reaches Aurora's success or failed list, so Tender would show it as "Seen on chain" and keep warning about it. Close it with the operator route (platform key only):

```
POST /internal/payments/<paymentId>/resolve
Authorization: Bearer <TENDER_PLATFORM_KEY>
{ "outcome": "refunded", "tx_hash": "<refund tx>", "note": "Aurora support refunded the sender" }
{ "outcome": "settled", "tx_hash": "<delivery tx>", "amount_settled": "19.90", "note": "Aurora delivered by hand" }
```

Check the proof transaction on-chain first. Only a payment still waiting on Aurora can be closed, once. It records the proof and note on the payment (shown in its history), resolves an open recovery task, re-judges a normal invoice and sends the webhook the poller would (a settled standing deposit gets `deposit.settled`; there is no webhook for a refund). The stuck-deposit warning stops.

## Retention

Railway keeps a limited window of logs. The database keeps the permanent record (payments, transfers, events), so use the logs to see what happened recently and alerts to hear about it.
