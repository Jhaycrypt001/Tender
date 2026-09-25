import { request } from "./client";
import type {
  ApiResult,
  Balance,
  Merchant,
  SettlementChallenge,
  UpdateMerchantInput,
} from "./types";

/**
 * Merchant account, balance and settlement.
 * Merchant-authenticated — SERVER ONLY.
 */

/** Settlement address, settlement asset, webhook URL, fee. */
export function getMerchant(): Promise<ApiResult<Merchant>> {
  return request<Merchant>("/v1/merchant");
}

/**
 * Update merchant settings.
 *
 * ⚠️ Changing `settlement_address` resets `settlement_verified` to false on the
 * backend, and an unverified address must not receive money. The UI has to
 * walk the merchant through the challenge below straight afterwards, or they
 * are left with payments that cannot land and no explanation.
 */
export function updateMerchant(
  input: UpdateMerchantInput,
): Promise<ApiResult<Merchant>> {
  return request<Merchant>("/v1/merchant", { method: "PATCH", body: input });
}

/** Settled and unsettled totals per asset. Backs the Home balance card. */
export function getBalance(): Promise<ApiResult<Balance>> {
  return request<Balance>("/v1/merchant/balance");
}

/* --------------------------------------------------------------------------
   Proof of control.

   Without this, a settlement address is protected by nothing more than a
   session cookie: whoever takes over the account points it at their own wallet
   and every future payment follows. Signing a nonce with the destination
   wallet proves the merchant actually holds it.
   -------------------------------------------------------------------------- */

/** Ask for a nonce to sign. Show `message` verbatim; never rebuild it locally. */
export function requestSettlementChallenge(
  address: string,
): Promise<ApiResult<SettlementChallenge>> {
  return request<SettlementChallenge>("/v1/merchant/settlement/challenge", {
    method: "POST",
    body: { address },
  });
}

/** Submit the signature. On success the merchant comes back verified. */
export function verifySettlement(
  nonce: string,
  signature: string,
): Promise<ApiResult<Merchant>> {
  return request<Merchant>("/v1/merchant/settlement/verify", {
    method: "POST",
    body: { nonce, signature },
  });
}

/** Fire a test event at the merchant's webhook URL. */
export function testWebhook(): Promise<ApiResult<{ delivered: boolean }>> {
  return request<{ delivered: boolean }>("/v1/merchant/webhook/test", {
    method: "POST",
  });
}
