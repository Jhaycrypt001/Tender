import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import type { Merchant } from "../generated/prisma/client.js";
import { Decimal } from "../lib/money.js";
import { amount } from "./serialize.js";

const USD_STABLES = new Set(["USDC", "USDT0"]);

/**
 * The Home screen's balance, computed from payments — Tender holds no funds,
 * so this is a ledger of what has landed at the merchant's own address, not a
 * custodial balance.
 *
 * - settled:   what reached the settlement address, in the settlement asset.
 * - unsettled: deposits seen but not yet paid out, valued in USD at detection
 *              (their final settled amount is not known until they land).
 */
export async function balance(db: Db, merchant: Merchant): Promise<z.output<typeof S.Balance>> {
  const [settled, unsettled] = await Promise.all([
    db.payment.aggregate({
      where: { invoice: { merchantId: merchant.id }, status: "SETTLED" },
      _sum: { amountSettled: true },
    }),
    db.payment.aggregate({
      where: { invoice: { merchantId: merchant.id }, status: "DETECTED" },
      _sum: { amountInUsd: true },
    }),
  ]);

  const asset = merchant.settlementAsset ?? "USDC";
  const settledSum = new Decimal(settled._sum.amountSettled?.toString() ?? "0");
  const unsettledSum = new Decimal(unsettled._sum.amountInUsd?.toString() ?? "0");

  return {
    settled: [{ asset, amount: amount(settledSum) }],
    unsettled: [{ asset: "USD", amount: amount(unsettledSum.toDecimalPlaces(2)) }],
    // A dollar total is only honest when the settlement asset is a dollar stablecoin.
    display_total: USD_STABLES.has(asset) ? { currency: "USD", amount: amount(settledSum.toDecimalPlaces(2)) } : null,
  };
}
