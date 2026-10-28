# Cash out (off-ramp): the plan

**Status (2026-10-28):** the backend half is written and tested locally, **not merged**. It can't be tried against a real sale until Ramp issues the production API key (applied for; they may ask for a registered entity). The frontend half is not started. Everything marked "checked" was checked against Ramp Network's live API and docs on 2026-09-29, and the asset list, Monad support and NGN/KES rejection were re-checked on 2026-10-28.

**Short version:** Tender will not build an off-ramp. Turning USDC into money in a bank account needs a licensed company that handles ID checks and bank payouts. Tender never holds anyone's funds, and this plan keeps it that way. We plug in **Ramp Network**, whose own window does the ID check and the payout. The merchant sends USDC from their own wallet, and the money lands in their bank.

---

## 1. Why Ramp Network

| What we need | What Ramp has (checked) |
|---|---|
| Sell **USDC on Monad**, the exact asset Tender settles in | ✅ `USDC` on chain `MONAD`, enabled for off-ramp. Contract `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` |
| Payout currencies | ✅ USD, EUR, GBP |
| Limits per sale | USD: min **$7.50**, max **$17,000** · EUR: min **€6.62**, max **€14,992** · GBP: min **£5.67**, max **£12,851** |
| A web SDK we can drop in | ✅ `@ramp-network/ramp-instant-sdk` v6.2.0, MIT, with an `OFFRAMP` flow |
| Webhooks for sales | ✅ `offrampWebhookV3Url` in the SDK config |

These numbers come from Ramp's live API and change over time. Always read them from the API; never hardcode them:

```
GET https://api.rampnetwork.com/api/host-api/v3/offramp/assets?currencyCode=USD
```

MoonPay also has Monad off-ramps, but only through one wallet partnership (HaHa Wallet). Onramper is an aggregator over many providers. Ramp is the most direct fit today.

---

## 2. ⚠️ Naira is not supported

Ramp's off-ramp API **rejects NGN** (`FIAT_CURRENCY_NOT_SUPPORTED`). KES is rejected too. So a Nigerian merchant can't cash out to naira through Ramp. The Ramps screen must say so honestly, and must not show Nigeria as LIVE.

Options to look into, none of them checked yet:

1. **An Africa-focused off-ramp** (e.g. Yellow Card). Its Monad support is unknown, so check before planning anything around it.
2. **Route through Aurora first.** Tender already uses Aurora to move value between chains. If an African off-ramp takes USDT on Tron but not USDC on Monad, Aurora could convert first. That adds a step and a fee, so only do it if option 1 has no Monad support.
3. **Pay out in USD** to a merchant who has a USD account Ramp supports. Whether Ramp accepts Nigerian users for a USD payout is unknown. Ask Ramp.

---

## 3. How it works for the merchant

1. The merchant opens **Ramps** in the dashboard and taps **Cash out**.
2. Ramp's window opens in sell mode, with USDC on Monad already selected.
3. Inside Ramp's window, the merchant verifies their ID (first time only) and enters their bank or card details. None of that touches Tender.
4. Ramp gives a deposit address and an exact amount. The merchant sends the USDC from **their own wallet**, the same one Tender settles into.
5. Ramp pays the money out to the merchant's bank or card.
6. Ramp calls our webhook, and the cash-out appears in the merchant's Activity.

Tender never holds the USDC, the bank details or the ID documents.

---

## 4. Who does what

| # | Work | Who | Size |
|---|---|---|---|
| 1 | Apply to Ramp for a partner account and a **production API key with off-ramp enabled**. Their docs say off-ramp needs a production key with the feature switched on. | You (or your friend) | Days of waiting. **Start first.** |
| 2 | "Cash out" button and the Ramp window | You (frontend) | Small |
| 3 | "Send with your wallet" button inside Ramp (optional, v2) | You (frontend) | Medium |
| 4 | Real corridor list for the Ramps screen | Your friend (backend) | Small |
| 5 | Webhook: record each sale, show it in Activity | Your friend (backend) | Medium |

---

## 5. Frontend work (you)

### v1: the Cash out button

- Install `@ramp-network/ramp-instant-sdk`. It's a client-only package, so load it in a `"use client"` component.
- The merchant's Monad settlement address comes from the settings the dashboard already loads.

```ts
import { RampInstantSDK } from "@ramp-network/ramp-instant-sdk";

new RampInstantSDK({
  hostApiKey: process.env.NEXT_PUBLIC_RAMP_HOST_API_KEY!, // from step 1
  hostAppName: "Tender",
  hostLogoUrl: "https://<our domain>/logo.png",
  enabledFlows: ["OFFRAMP"],
  defaultFlow: "OFFRAMP",
  offrampAsset: "MONAD_USDC",
  // From GET /v1/ramps/widget: "/webhooks/ramp?t=rwt_…". Ramp sends no wallet or user id back, so this
  // token is the only way a sale can be matched to the merchant. NEVER put the merchant id here instead:
  // whoever opens the widget chooses this URL, so an id would let anyone file their sale under another merchant.
  offrampWebhookV3Url: `${API_BASE_URL}${widget.webhook_path}`,
}).show();
```

- In v1, leave out `useSendCryptoCallback`. Ramp then shows the deposit address and amount, and the merchant sends from their wallet by hand. That needs **no wallet code in Tender**, which matters because the dashboard has none today.
- `offrampAsset` still works in v6.2.0. Ramp's docs call it deprecated in favour of `enabledCryptoAssets`, but that option isn't in the v6.2.0 types yet. Switch when the SDK ships it.
- `hostApiKey` identifies us to Ramp. It is **not** a secret like `TENDER_API_KEY`, which is why `NEXT_PUBLIC_` is correct here. Confirm this with Ramp when the key arrives; if they say otherwise, the widget URL has to be signed by the backend instead.
- Before opening the window, check the merchant's balance against the live minimum from §1. Don't open Ramp for $3.

### v2: "Send with your wallet"

- Set `useSendCryptoCallback: true` and register `sdk.onSendCrypto(async (assetInfo, amount, address) => ({ txHash }))`.
- The callback has to send `amount` of USDC to `address` on Monad (chain 143) and return the tx hash. With the browser wallet (`window.ethereum`), that's three calls:
  1. `eth_requestAccounts`
  2. `wallet_switchEthereumChain` to `0x8f` (143)
  3. `eth_sendTransaction` with an ERC-20 `transfer(address,uint256)`, using `assetInfo.decimals`
- No wagmi or viem is needed for this.
- Check that the connected account **is** the merchant's settlement address before sending. The balance is only there.

### The Ramps screen

- It already shows corridors with LIVE / COMING SOON / NOT OPEN badges and never fakes a payout. Keep that.
- Only show LIVE where the backend says Ramp really supports that currency (§6).
- Nigeria should show NOT OPEN, with a line saying naira payouts aren't available yet.
- The page still says a "licensed partner we have not signed yet" is needed. Reword it once the key arrives.
- `country` on a corridor is a label for the currency area ("United States", "Eurozone", "United Kingdom", "Nigeria"), not a promise that people in that country can be paid out. Confirm the wording.

### Activity

- Cash-outs come from `GET /v1/ramps/sales`, a third list beside payments in and transfers out. Merge it into the timeline as **money out**, next to payouts and refunds. It must never appear among payments received, or a withdrawal reads as revenue.
- The shape is `RampSale` in `backend/contract/schemas.ts`. Add the matching type to `frontend/src/lib/api/types.ts` (and `RampWidget` for the Cash out button); the backend then adds both to `contract.check.ts`.
- Statuses: `CREATED` (Ramp opened the sale), `RELEASED` (the payout was released), `EXPIRED` (it was not completed).

---

## 6. Backend work (your friend)

**Written and tested locally on 2026-10-28; not merged.** Tests pass against a fake Ramp and self-signed events. Nothing has been tried against a real Ramp sale.

1. **Real corridors** (`services/ramp.service.ts`, `GET /v1/ramps/corridors`).
   - For each currency we list (USD, EUR, GBP, NGN), it calls Ramp's `offramp/assets?currencyCode=…`.
   - A corridor is `LIVE` only if **the merchant's own settlement token** (USDC or USDT0) on `MONAD` comes back `enabled: true` **and** at our own contract address. Any other settlement asset is `NOT_OPEN`. Ramp's `400 FIAT_CURRENCY_NOT_SUPPORTED` is `NOT_OPEN`.
   - Every failure (timeout, bad response, outage) is `NOT_OPEN`, never `LIVE`. A wrong `LIVE` sends a merchant into a payout that fails; a wrong `NOT_OPEN` only makes them ask.
   - A clear answer is cached for an hour; a failure for one minute. A stale `LIVE` is never served.
   - Ramp's `maxPurchaseAmount` is a **per-sale** limit, not a daily one, so `daily_cap` stays empty. If the screen should show it, add an optional `per_sale_max` to the contract and tell the frontend.
2. **Webhook `POST /webhooks/ramp`** (`routes/ramp-webhook.ts`).
   - **Signature.** Ramp signs the body with ECDSA (secp256k1, SHA-256, DER, base64) in the `X-Body-Signature` header, over the body re-serialized with `fast-json-stable-stringify`. We verify with Ramp's published public key (production or testing, set by `RAMP_ENV`). Nothing in an unverified body is read. Bad or missing signature: 401, nothing stored.
   - **Matching a merchant.** Ramp sends no user or wallet id, so the merchant comes from `?t=<token>` on the webhook URL: a random 160-bit token per merchant, made the first time they ask for it (`GET /v1/ramps/widget`). Not the merchant id: the widget runs in the browser with a public key, so whoever opens it picks the URL, and an id would let anyone who knew it file their own real sale in another merchant's Activity. The token is not signed either, so it is only looked up. A signed sale with an unknown or missing token is kept unattributed and never shown, with an error log line so someone can look. Once filed, a sale never moves to another merchant.
   - **Logging.** A rejected request (bad signature) is logged at most once per caller every 30 seconds, so a flood costs a few lines. The token never appears in a log line.
   - **Amounts.** `crypto.amount` is taken as Ramp's documented digit string, or as a JSON number only while it is a safe integer (past 2^53 the digits are already wrong, so it is refused).
   - **Storing.** One `RampSale` row per Ramp sale: crypto amount (converted from base units), fiat amount and currency, status, payout method, transaction hash.
   - **Dedupe.** Unique on Ramp's sale id. Ramp retries four times, three minutes apart, and sends several events per sale, so a status only moves forward: `CREATED` to `RELEASED` or `EXPIRED`, never back, and the first final state wins.
   - **Reply.** 204 only once the sale is stored. An unreadable signed event is a loud 400. An event that isn't an off-ramp state we record is acknowledged and ignored.
3. **Sales list** (`GET /v1/ramps/sales`): a merchant's own cash-outs, newest first, with cursor paging. See "Activity" in §5.
4. **Widget config** (`GET /v1/ramps/widget`): `{ webhook_path }`, the path the Cash out button passes to Ramp (after the API base URL).
5. **Nothing custodial.** The backend never creates a deposit address for this and never moves funds. Ramp and the merchant's wallet do all of it.

Still to do before merging: apply the migration (`20261028000000_ramp_sales`) to production, run one real sandbox sale with `RAMP_ENV=testing` to prove the signature check against a signature Ramp made, and test a full cash-out end to end.

---

## 7. Check before building

- [x] Is Ramp's Monad USDC the **same token** Aurora settles merchants in? Ramp's API returns `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` for USDC and `0xe7cd86e13ac4309349f30b3435a9d337750fc82d` for USDT0, both identical to `backend/src/lib/tokens.ts` (checked 2026-10-28). The corridor check also compares the address, so a mismatch would show as `NOT_OPEN`.
- [ ] Does Ramp accept merchants (businesses) or only individuals? The flow above assumes the merchant does Ramp's own ID check as a person. Asked of Ramp.
- [ ] Which countries can receive USD, EUR and GBP payouts? Ramp's site says "150+ countries" and that availability "is displayed at checkout", with no list. **This decides whether Nigerian merchants benefit at all.** Asked of Ramp.
- [x] Ramp's webhook signature scheme and retry policy. Read from https://docs.rampnetwork.com/webhooks: ECDSA signature scheme as in §6; four retries, three minutes apart, then no more. Ordering and dedupe are not guaranteed, which is why status only moves forward.
- [ ] Is `hostApiKey` safe to expose in the browser? (§5) Asked of Ramp. If not, the widget URL must be signed by a new backend route.
- [ ] Naira: the options in §2.
- [ ] A real sandbox sale verified end to end (needs the production key).

---

## Sources

- Ramp Network, Monad launch: https://rampnetwork.com/blog/monad-live-on-ramp-network
- Ramp off-ramp docs: https://docs.rampnetwork.com/off-ramp
- Ramp SDK configuration: https://docs.rampnetwork.com/configuration
- Ramp webhooks (payload, signature, retries, public keys): https://docs.rampnetwork.com/webhooks
- Ramp live off-ramp assets API: https://api.rampnetwork.com/api/host-api/v3/offramp/assets
- Web SDK: https://www.npmjs.com/package/@ramp-network/ramp-instant-sdk (v6.2.0 types read directly)
- MoonPay × HaHa Wallet: https://www.moonpay.com/newsroom/hahawallet
