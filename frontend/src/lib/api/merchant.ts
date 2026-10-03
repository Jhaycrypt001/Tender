import { request } from "./server";
import type {
  ApiKeyList,
  ApiResult,
  Balance,
  CreatedApiKey,
  Merchant,
  RotatedWebhookSecret,
  SettlementChallenge,
  UpdateMerchantInput,
  WebhookDeliveryList,
  WebhookDeliveryStatus,
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

/** What the API says happened when it fired a test event. */
export type WebhookTestResult = {
  /** True only when the endpoint answered with a 2xx. */
  delivered: boolean;
  /** The endpoint's HTTP status, or null when it never answered at all. */
  status_code: number | null;
  /** Why it failed, when it did: a timeout, a refused connection, a non-2xx. */
  error?: string;
  event_id: string;
};

/** Fire a test event at the merchant's webhook URL. */
export function testWebhook(): Promise<ApiResult<WebhookTestResult>> {
  return request<WebhookTestResult>("/v1/merchant/webhook/test", {
    method: "POST",
  });
}

/* --------------------------------------------------------------------------
   API keys and the webhook secret.

   ⚠️ A key or secret is in the CREATE response and nowhere else, ever. The
   screen shows it once; nothing here caches or stores it.
   -------------------------------------------------------------------------- */

/** Active keys, newest first. Prefixes only. */
export function listApiKeys(): Promise<ApiResult<ApiKeyList>> {
  return request<ApiKeyList>("/v1/merchant/api-keys");
}

/** Issue a key. The plaintext `key` is in this response only. At most 10 active (409). */
export function createApiKey(): Promise<ApiResult<CreatedApiKey>> {
  return request<CreatedApiKey>("/v1/merchant/api-keys", { method: "POST" });
}

/** Revoke a key. It stops working at once. 404 if it is not this merchant's. */
export function revokeApiKey(id: string): Promise<ApiResult<void>> {
  return request<void>(`/v1/merchant/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Replace the webhook signing secret. The old one stops verifying immediately. */
export function rotateWebhookSecret(): Promise<ApiResult<RotatedWebhookSecret>> {
  return request<RotatedWebhookSecret>("/v1/merchant/webhook/secret", {
    method: "POST",
  });
}

/** Recent webhook deliveries, newest first. `failed` = every retry used. */
export function listWebhookDeliveries(
  status?: WebhookDeliveryStatus,
  limit = 25,
): Promise<ApiResult<WebhookDeliveryList>> {
  return request<WebhookDeliveryList>("/v1/merchant/webhook/deliveries", {
    query: { status, limit },
  });
}
