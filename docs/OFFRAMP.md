# Cash out (off-ramp): the plan

**Status:** planned for after the hackathon. Nothing is built. Everything marked "checked" was checked on 2026-09-29 against Ramp Network's live API and published SDK.

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
  offrampWebhookV3Url: "https://<api domain>/webhooks/ramp", // your friend's route
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

---

## 6. Backend work (your friend)

1. **Real corridors.** `GET /v1/ramps/corridors` returns `[]` today (`routes/dashboard.ts`).
   - For each currency we list, call Ramp's `offramp/assets?currencyCode=…`.
   - Mark the corridor `LIVE` only if `USDC` on `MONAD` comes back `enabled: true`.
   - A `400 FIAT_CURRENCY_NOT_SUPPORTED` means `NOT_OPEN`.
   - Cache the result for an hour or so.
   - ⚠️ Ramp's `maxPurchaseAmount` is a **per-sale** limit, not a daily one. Don't put it in `daily_cap`. If the screen should show it, add a new optional field such as `per_sale_max` to the contract, and tell the frontend.
2. **Webhook `POST /webhooks/ramp`.**
   - Verify Ramp's signature before trusting anything. The method is in Ramp's off-ramp webhook docs; read them when the key arrives.
   - Store the sale: id, crypto amount, fiat amount and currency, status.
   - Dedupe on Ramp's sale id, because webhooks can arrive twice.
   - Show the sale in Activity as a cash-out, not as a payment received.
3. **Nothing custodial.** The backend never creates a deposit address for this and never moves funds. Ramp and the merchant's wallet do all of it.

---

## 7. Check before building

- [ ] Is Ramp's Monad USDC (`0x754704Bc…b603`) the **same token** Aurora settles merchants in? Aurora resolves "USDC on monad" by symbol, so print the asset id Aurora uses and compare the contract address. If they differ, merchants would hold a USDC that Ramp won't buy.
- [ ] Does Ramp accept merchants (businesses) or only individuals? The flow above assumes the merchant does Ramp's own ID check as a person.
- [ ] Which countries can receive USD, EUR and GBP payouts? Ramp's post says "globally", with no country list.
- [ ] Ramp's webhook signature scheme and retry policy.
- [ ] Is `hostApiKey` safe to expose in the browser? (§5)
- [ ] Naira: the options in §2.

---

## Sources

- Ramp Network, Monad launch: https://rampnetwork.com/blog/monad-live-on-ramp-network
- Ramp off-ramp docs: https://docs.rampnetwork.com/off-ramp
- Ramp SDK configuration: https://docs.rampnetwork.com/configuration
- Ramp live off-ramp assets API: https://api.rampnetwork.com/api/host-api/v3/offramp/assets
- Web SDK: https://www.npmjs.com/package/@ramp-network/ramp-instant-sdk (v6.2.0 types read directly)
- MoonPay × HaHa Wallet: https://www.moonpay.com/newsroom/hahawallet
