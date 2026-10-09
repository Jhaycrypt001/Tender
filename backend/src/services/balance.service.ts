import type { z } from "zod";
import type * as S from "../../contract/schemas.js";
import type { Db } from "../db/client.js";
import type { Merchant } from "../generated/prisma/client.js";
import { getAddress, isAddress } from "viem";
import { Decimal } from "../lib/money.js";
import { tokenFor } from "../lib/tokens.js";
import type { TransferChain } from "./transfer-chain.js";
import { amount } from "./serialize.js";

const USD_STABLES = new Set(["USDC", "USDT0"]);

/** The settlement wallet's balance of its settlement token, or null when it cannot be read. */
async function walletBalance(merchant: Merchant, wallet?: Pick<TransferChain, "tokenBalance">): Promise<Decimal | null> {
  const token = tokenFor(merchant.settlementAsset ?? "USDC");
  if (!wallet || !token || !merchant.settlementAddress || !isAddress(merchant.settlementAddress)) return null;
  try {
    const raw = await wallet.tokenBalance(token.address, getAddress(merchant.settlementAddress));
    return new Decimal(raw.toString()).div(new Decimal(10).pow(token.decimals));
  } catch {
    return null;
  }
}

/**
 * The Home screen's balance, computed from payments — Tender holds no funds,
 * so this is a ledger of what has landed at the merchant's own address, not a
 * custodial balance.
 *
 * - settled:   what reached the settlement address, in the settlement asset.
 * - unsettled: deposits seen but not yet paid out, valued in USD at detection
 *              (their final settled amount is not known until they land).
 */
export async function balance(
  db: Db,
  merchant: Merchant,
  wallet?: Pick<TransferChain, "tokenBalance">,
): Promise<z.output<typeof S.Balance>> {
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
  // ⚠️ "Settled" is what the wallet HOLDS, read from the chain. Summing payments in counted
  // money long after the merchant had sent it out again: Home said 20.45 USDC while the
  // wallet held 7.45. The ledger sum is only the fallback when the chain cannot be read.
  const onChain = await walletBalance(merchant, wallet);
  const settledSum = onChain ?? new Decimal(settled._sum.amountSettled?.toString() ?? "0");
  const unsettledSum = new Decimal(unsettled._sum.amountInUsd?.toString() ?? "0");

  return {
    settled: [{ asset, amount: amount(settledSum) }],
    unsettled: [{ asset: "USD", amount: amount(unsettledSum.toDecimalPlaces(2)) }],
    // A dollar total is only honest when the settlement asset is a dollar stablecoin.
    display_total: USD_STABLES.has(asset) ? { currency: "USD", amount: amount(settledSum.toDecimalPlaces(2)) } : null,
  };
}
