"use client";

import { useCallback } from "react";
import { useSignTypedData } from "@privy-io/react-auth";
import {
  prepareTransferAction,
  submitTransferAction,
  transferStatusAction,
  type TransferResult,
} from "@/app/app/(dash)/pay/transfer-actions";
import type { PrepareTransferInput, Transfer } from "@/lib/api/types";

/**
 * Sends money out of the merchant's own wallet, from the browser.
 *
 * The steps, and who does what:
 *   1. The server validates and returns what must be signed (nothing moves).
 *   2. The merchant's WALLET signs one authorization per recipient, here, with
 *      Privy. Each names the exact recipient, amount and deadline, so nothing
 *      can be changed once signed. Signing costs no gas.
 *   3. The server relays the signatures and pays the network fee.
 *   4. This waits for the chain to confirm, because "submitted" is not "sent".
 *
 * Returns a result instead of throwing, so a screen can show a sentence.
 * Only usable inside Privy's provider.
 */

export type SendStep =
  | { phase: "preparing" }
  | { phase: "signing"; index: number; total: number }
  | { phase: "sending" }
  | { phase: "confirming" };

export type SendOutcome =
  | { ok: true; transfer: Transfer; /** False when it is still being confirmed after we stopped waiting. */ settled: boolean }
  | { ok: false; message: string; fields?: Record<string, string> };

const POLL_EVERY_MS = 3_000;
const GIVE_UP_AFTER_MS = 120_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** EIP-712 requires the domain's own type list; viem derives the same one from the domain fields, in this order. */
const DOMAIN_TYPE = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

export function useSendTransfer() {
  const { signTypedData } = useSignTypedData();

  return useCallback(
    async (input: PrepareTransferInput, onStep?: (step: SendStep) => void): Promise<SendOutcome> => {
      try {
        onStep?.({ phase: "preparing" });
        const prepared: TransferResult = await prepareTransferAction(input);
        if (!prepared.ok) return prepared;
        const { transfer } = prepared;
        const authorizations = transfer.authorizations ?? [];
        if (authorizations.length === 0 || authorizations.length !== transfer.lines.length) {
          return { ok: false, message: "We could not prepare this transfer. Nothing was sent." };
        }

        const signatures: string[] = [];
        for (const [i, auth] of authorizations.entries()) {
          onStep?.({ phase: "signing", index: i + 1, total: authorizations.length });
          const line = transfer.lines[auth.index]!;
          // Another chain: the wallet signs to a one-off Monad address, so say where the money is REALLY going.
          const dest = line.dest;
          const goingTo = dest
            ? `Send ${line.amount} ${transfer.asset} to ${dest.address} on ${dest.chain_name}${dest.expected_out ? `, arriving as about ${dest.expected_out} ${dest.asset}` : ""}. It is carried by Aurora, so it first goes to ${line.to} on Monad.`
            : `Send ${line.amount} ${transfer.asset} to ${line.to}.`;
          const { signature } = await signTypedData(
            {
              domain: auth.typed_data.domain,
              types: { EIP712Domain: DOMAIN_TYPE, ...auth.typed_data.types },
              primaryType: auth.typed_data.primaryType,
              message: auth.typed_data.message,
            },
            {
              address: transfer.from,
              uiOptions: {
                title: authorizations.length > 1 ? `Confirm payment ${i + 1} of ${authorizations.length}` : "Confirm this payment",
                description: `${goingTo} This only authorizes exactly that. It is free: Tender pays the network fee.`,
                buttonText: "Confirm",
              },
            },
          );
          signatures.push(signature);
        }

        onStep?.({ phase: "sending" });
        const submitted = await submitTransferAction(transfer.id, signatures);
        if (!submitted.ok) return submitted;

        onStep?.({ phase: "confirming" });
        let latest = submitted.transfer;
        const started = Date.now();
        while (latest.status === "SUBMITTED" && Date.now() - started < GIVE_UP_AFTER_MS) {
          await sleep(POLL_EVERY_MS);
          const next = await transferStatusAction(transfer.id);
          if (next.ok) latest = next.transfer;
        }

        if (latest.status === "FAILED" || latest.status === "EXPIRED") {
          return { ok: false, message: latest.failure_reason ?? "The transfer did not go through. No money moved." };
        }
        return { ok: true, transfer: latest, settled: latest.status === "CONFIRMED" };
      } catch (err) {
        console.error("[tender] sending a transfer failed", err);
        const code = (err as { code?: string } | null)?.code;
        if (code === "user_rejected" || /reject|denied|cancel|closed/i.test(String((err as Error)?.message))) {
          return { ok: false, message: "You closed the confirmation, so nothing was sent." };
        }
        return { ok: false, message: "Something went wrong before the transfer could be sent. Nothing was sent." };
      }
    },
    [signTypedData],
  );
}

export const STEP_LABEL: Record<SendStep["phase"], string> = {
  preparing: "Preparing…",
  signing: "Confirm in your wallet…",
  sending: "Sending…",
  confirming: "Waiting for the network…",
};
