import { request } from "./client";
import type { ApiResult, RampCorridor } from "./types";

/**
 * Off-ramp corridors: settled crypto out to a bank account.
 * Merchant-authenticated — SERVER ONLY.
 *
 * Most corridors are not live. The UI shows them anyway, marked honestly, and
 * that reads as a finished product — a fake bank payout does not.
 */
export function getCorridors(): Promise<ApiResult<RampCorridor[]>> {
  return request<RampCorridor[]>("/v1/ramps/corridors");
}
