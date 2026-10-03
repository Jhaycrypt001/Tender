"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { useExportWallet } from "@privy-io/react-auth";
import { Card, CardHeader } from "@/components/dash/card";
import { CopyValue } from "@/components/dash/copy";
import { ReadOnlyField, Select } from "@/components/dash/field";
import { Action, Submit } from "@/components/dash/action";
import {
  saveSettlementAssetAction,
  type SettlementState,
} from "@/app/app/(dash)/settings/actions";
import { SETTLEMENT_ASSETS, SETTLEMENT_ASSET_VALUES } from "@/lib/settlement-assets";
import { useSettlementSetup } from "@/lib/use-settlement-setup";

/**
 * Where money lands.
 *
 * The address is the wallet created for the merchant when they signed in. It
 * is shown, never typed: the sign-in setup saves it and proves it is theirs,
 * so there is no pasted address to get wrong or to be swapped by someone who
 * reached the account. What the merchant chooses here is the ASSET they are
 * paid in.
 *
 * Normally the wallet is already verified before they ever see this screen.
 * The button below exists for the case where that step did not finish (they
 * closed the tab, or it failed), so it can be completed from here.
 */

const EMPTY_SAVE: SettlementState = {};

/** One consistent way of showing a message, so alerts never look ad hoc. */
function Note({
  children,
  tone = "error",
}: {
  children: React.ReactNode;
  tone?: "error" | "ok";
}) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className="text-[0.875rem] leading-relaxed text-ink"
    >
      <span aria-hidden="true" className="mr-1.5 text-sand">
        &#9632;
      </span>
      {children}
    </p>
  );
}

export function SettlementPanel({
  address,
  asset,
  verified,
}: {
  address: string;
  asset: string;
  verified: boolean;
}) {
  const [save, saveAction] = useActionState(saveSettlementAssetAction, EMPTY_SAVE);

  return (
    <div className="flex flex-col gap-4">
      <Card tone={verified ? "quiet" : undefined} marks={!verified}>
        <CardHeader
          label="Your wallet"
          hint="Every payment converts to one asset and lands in this wallet, on Monad."
        />

        {address ? (
          <div className="flex flex-col gap-5">
            <ReadOnlyField label="Monad address" action={<CopyValue value={address} />}>
              <code className="font-mono text-[0.8125rem]">{address}</code>
            </ReadOnlyField>

            {verified ? (
              <>
                <p className="text-[0.9375rem] leading-relaxed">
                  <span aria-hidden="true" className="mr-1.5 text-sand">
                    &#9632;
                  </span>
                  Verified. Payments settle here.
                </p>
                <p className="text-[0.8125rem] leading-relaxed text-mute">
                  This wallet was created for you when you signed in with Google.
                </p>
                <ExportWallet address={address} />
              </>
            ) : (
              <VerifyWallet
                intro="This wallet is not verified yet, so payments cannot settle to it. Verifying takes one click: your wallet signs a message for you, with nothing to copy or approve."
                button="Verify my wallet"
              />
            )}
          </div>
        ) : (
          <VerifyWallet
            intro="Your wallet has not been set up yet. Setting it up takes one click."
            button="Set up my wallet"
          />
        )}
      </Card>

      <Card>
        <CardHeader label="Paid in" hint="Whatever the buyer sends, you receive this." />
        <form action={saveAction} className="flex flex-col gap-5">
          <Select
            label="Settle in"
            name="settlement_asset"
            defaultValue={SETTLEMENT_ASSET_VALUES.includes(asset) ? asset : "USDC"}
            error={save.fields?.settlement_asset}
            hint="The asset your payments arrive as on Monad. Applies to new payments."
            options={SETTLEMENT_ASSETS.map((a) => ({ value: a.value, label: a.label }))}
          />

          {save.message && <Note>{save.message}</Note>}
          {save.ok && <Note tone="ok">{save.ok}</Note>}

          <div>
            <Submit pendingLabel="Saving…">Save</Submit>
          </div>
        </form>
      </Card>
    </div>
  );
}

/**
 * Lets the merchant take their wallet with them: Privy's own secure screen
 * shows the private key, which this app never sees (it loads in an iframe on
 * Privy's domain). Import it into Rabby or MetaMask to move funds out.
 */
function ExportWallet({ address }: { address: string }) {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return null;
  return <ExportWalletLive address={address} />;
}

function ExportWalletLive({ address }: { address: string }) {
  const { exportWallet } = useExportWallet();
  const [error, setError] = useState("");

  async function open() {
    setError("");
    try {
      await exportWallet({ address });
    } catch (err) {
      console.error("[tender] wallet export failed", err);
      setError("We couldn't open the export screen. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-3 border-t border-ink/10 pt-5">
      <p className="text-[0.8125rem] leading-relaxed text-mute">
        You own this wallet. Export it to move your money into Rabby or MetaMask. The key is shown
        only to you, on Privy&apos;s secure screen. Never share it with anyone.
      </p>
      {error && <Note>{error}</Note>}
      <div>
        <Action onClick={() => void open()}>Export wallet</Action>
      </div>
    </div>
  );
}

/**
 * Finishes the wallet setup from here: saves the wallet as the settlement
 * address if it is not already, and has it sign the one-off message.
 *
 * Only offered inside Privy's provider. Without sign-in configured there is no
 * wallet to set up, so it says so instead of crashing.
 */
function VerifyWallet({ intro, button }: { intro: string; button: string }) {
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
    return <p className="text-[0.9375rem] leading-relaxed text-mute">Sign-in is not set up in this environment, so there is no wallet to set up.</p>;
  }
  return <VerifyWalletLive intro={intro} button={button} />;
}

function VerifyWalletLive({ intro, button }: { intro: string; button: string }) {
  const run = useSettlementSetup();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify() {
    setBusy(true);
    setError("");
    const failure = await run();
    if (failure) {
      setError(failure);
      setBusy(false);
      return;
    }
    // Reload the server data so the card flips to "Verified".
    router.refresh();
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[0.9375rem] leading-relaxed">{intro}</p>
      {error && <Note>{error}</Note>}
      <div>
        <Action variant="primary" onClick={() => void verify()} disabled={busy}>
          {busy ? "Verifying…" : button}
        </Action>
      </div>
    </div>
  );
}
