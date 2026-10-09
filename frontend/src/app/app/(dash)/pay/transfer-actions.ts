"use server";

import { getTransfer, listPayoutChains, prepareTransfer, quoteTransfer, submitTransfer } from "@/lib/api/transfers";
import type { ApiError, PayoutChain, PrepareTransferInput, QuoteTransferResult, Transfer } from "@/lib/api/types";

/**
 * The browser's only way to the transfer endpoints: it cannot call them itself,
 * because they carry the platform key. Each action returns a plain result and
 * never throws, so the sending flow can show a sentence instead of crashing.
 */

export type TransferResult =
  | { ok: true; transfer: Transfer }
  | { ok: false; message: string; fields?: Record<string, string> };

/** What each failure means to a merchant, in the words the screen should use. */
function explain(error: ApiError): { message: string; fields?: Record<string, string> } {
  if (error.kind === "not_configured") return { message: "The Tender API is not connected in this environment, so nothing can be sent." };
  if (error.kind === "rate_limited") return { message: "That is a lot of transfers in a short time. Wait a moment and try again." };
  // The backend's messages for these are already written for the merchant.
  return { message: error.message || "That did not go through. Nothing was sent.", fields: error.fields };
}

export async function prepareTransferAction(input: PrepareTransferInput): Promise<TransferResult> {
  const result = await prepareTransfer(input);
  return result.ok ? { ok: true, transfer: result.data } : { ok: false, ...explain(result.error) };
}

export async function submitTransferAction(id: string, signatures: string[]): Promise<TransferResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, message: "That transfer could not be found." };
  const result = await submitTransfer(id, { signatures });
  return result.ok ? { ok: true, transfer: result.data } : { ok: false, ...explain(result.error) };
}

/** The chains a payout or refund can go to. Empty when the list cannot be read: the form then offers Monad only. */
export async function payoutChainsAction(): Promise<PayoutChain[]> {
  const result = await listPayoutChains();
  return result.ok ? result.data.data : [];
}

/** A dry run of a payout to another chain. Never throws; a failure is a sentence under the form. */
export async function quoteTransferAction(input: { dest_chain: string; to: string; amount: string }): Promise<QuoteTransferResult> {
  if (!/^[a-z]{2,32}$/.test(input.dest_chain)) return { ok: false, field: "chain", message: "Choose a chain." };
  const result = await quoteTransfer(input);
  if (result.ok) return result.data;
  return { ok: false, field: "chain", message: result.error.message || "We could not check that just now. Try again." };
}

export async function transferStatusAction(id: string): Promise<TransferResult> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, message: "That transfer could not be found." };
  const result = await getTransfer(id);
  return result.ok ? { ok: true, transfer: result.data } : { ok: false, ...explain(result.error) };
}
