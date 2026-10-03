import { cookies } from "next/headers";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import { SERVER_BASE, send, type RequestOptions } from "./client";
import type { ApiResult } from "./types";

/**
 * The merchant half of the API client. ⚠️ SERVER ONLY.
 *
 * Every merchant call sends `Authorization: Bearer <TENDER_PLATFORM_KEY>` plus
 * `X-Tender-Merchant: <merchant id>`. The platform key can act as ANY merchant,
 * so it is read only here, and this module imports `next/headers`, which makes
 * the build fail if a client component ever pulls it in.
 *
 * The merchant id comes from the signed session cookie and nowhere else. It is
 * never taken from a form field, a query string or a header the browser sends:
 * the cookie is HMAC-signed, so a user cannot change which merchant they act as
 * without breaking the signature.
 */

/** Not NEXT_PUBLIC_ prefixed, so Next never inlines it into the browser bundle. */
const PLATFORM_KEY = process.env.TENDER_PLATFORM_KEY ?? "";

/**
 * True when sign-ins should be linked to merchants: the API is reachable and
 * the platform key is set. While false, the dashboard runs without a merchant
 * and every screen shows its "not connected" state, as before the backend existed.
 */
export function accountsEnabled(): boolean {
  return Boolean(SERVER_BASE && PLATFORM_KEY);
}

/** The merchant this request acts for, from the signed session cookie. */
async function currentMerchantId(): Promise<string | undefined> {
  const jar = await cookies();
  return decodeSession(jar.get(SESSION_COOKIE)?.value)?.merchantId;
}

/**
 * Authenticated call against a merchant route, as the signed-in merchant.
 *
 * A session with no merchant id (one issued before accounts were linked) is
 * refused here rather than sent: the API would answer 401 anyway, and this way
 * the message says what to do.
 */
export async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  const merchantId = await currentMerchantId();
  if (!merchantId && accountsEnabled()) {
    return {
      ok: false,
      error: {
        kind: "unauthorized",
        message: "This session isn't linked to a Tender account. Sign out and back in.",
        status: 401,
      },
    };
  }
  return send<T>(SERVER_BASE, path, options, { key: PLATFORM_KEY, merchantId });
}

/**
 * Call an `/internal/*` route with the platform key and no merchant. Only for
 * the few routes that act for no merchant, such as finding the merchant for a
 * sign-in. Everything else goes through `request()`.
 */
export function platformRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  return send<T>(SERVER_BASE, path, options, { key: PLATFORM_KEY });
}
