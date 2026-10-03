"use client";

import { useCallback } from "react";
import { getIdentityToken, useSignMessage } from "@privy-io/react-auth";
import {
  completeSettlementAction,
  prepareSettlementAction,
} from "@/app/app/wallet-actions";

/**
 * Runs the settlement setup from the browser: the merchant's embedded wallet
 * signs the backend's one-off message, with no popup and nothing to copy.
 *
 * Returns a function resolving to `null` on success, or a sentence to show the
 * merchant on failure. It never throws, so callers need no try/catch.
 *
 * ⚠️ The message comes from the backend through `prepareSettlementAction` and
 * goes to the wallet untouched, so the string signed is the string checked.
 * Only usable inside Privy's provider.
 */
export function useSettlementSetup() {
  const { signMessage } = useSignMessage();

  /**
   * Signs silently when Privy allows it, and otherwise with Privy's own
   * confirmation, worded so the merchant knows what they are approving.
   *
   * ⚠️ Silent signing is refused when the Privy app has "enforce wallet UIs" on
   * (the dashboard setting wins over `showWalletUIs: false`). Rather than depend
   * on that switch, the silent attempt falls back to the confirmation. The same
   * message is signed either way, so the same proof reaches the backend.
   */
  const sign = useCallback(
    async (message: string, address: string): Promise<string> => {
      try {
        const { signature } = await signMessage(
          { message },
          { uiOptions: { showWalletUIs: false }, address },
        );
        return signature;
      } catch (silentErr) {
        console.warn("[tender] silent signing refused, asking for confirmation", silentErr);
        const { signature } = await signMessage(
          { message },
          {
            address,
            uiOptions: {
              showWalletUIs: true,
              title: "Confirm your Tender wallet",
              description:
                "This proves this wallet is yours so payments can settle to it. It is free: no money moves and no fee is charged.",
              buttonText: "Confirm",
            },
          },
        );
        return signature;
      }
    },
    [signMessage],
  );

  return useCallback(
    async (
      onStep?: (step: "wallet" | "settlement") => void | Promise<void>,
    ): Promise<string | null> => {
      try {
        await onStep?.("wallet");
        const token = await getIdentityToken();
        if (!token) return "Your sign-in session ended. Sign out and back in.";

        const prepared = await prepareSettlementAction(token);
        if (prepared.status === "error") return prepared.message;

        await onStep?.("settlement");
        if (prepared.status === "sign") {
          const signature = await sign(prepared.message, prepared.address);
          const done = await completeSettlementAction(prepared.nonce, signature);
          if (!done.ok) return done.message;
        }
        return null;
      } catch (err) {
        // Logged so a failure can be diagnosed; the merchant gets one plain sentence.
        console.error("[tender] wallet setup failed", err);
        const code = (err as { code?: string } | null)?.code;
        if (code === "user_rejected" || /reject|denied|cancel/i.test(String((err as Error)?.message))) {
          return "You closed the confirmation, so your wallet isn't verified yet. Try again when you're ready.";
        }
        return "We couldn't finish setting up your wallet. Try again.";
      }
    },
    [sign],
  );
}
