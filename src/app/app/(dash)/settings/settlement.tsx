"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { CopyValue } from "@/components/dash/copy";
import { Field, Select } from "@/components/dash/field";
import { Submit } from "@/components/dash/action";
import { Timestamp } from "@/components/dash/money";
import {
  saveSettlementAction,
  startChallengeAction,
  verifySettlementAction,
  type ChallengeState,
  type SettlementState,
  type VerifyState,
} from "@/app/app/(dash)/settings/actions";

/**
 * Where money lands, and the proof that the merchant owns it.
 *
 * Three forms, deliberately separate rather than one wizard:
 *
 *   1. the address + asset form
 *   2. "send me a nonce"
 *   3. "here is the signature"
 *
 * They are separate because step 2 happens in the merchant's WALLET, not in
 * this tab. A single multi-step form would have to survive the merchant
 * leaving, signing, and coming back, so instead each step is independently
 * re-runnable and none of them depends on the previous one still being on
 * screen. A merchant who closed the tab mid-verification just starts the
 * challenge again.
 */

const EMPTY_SAVE: SettlementState = {};
const EMPTY_CHALLENGE: ChallengeState = {};
const EMPTY_VERIFY: VerifyState = {};

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
  const [save, saveAction] = useActionState(saveSettlementAction, EMPTY_SAVE);
  const [challenge, challengeAction] = useActionState(
    startChallengeAction,
    EMPTY_CHALLENGE,
  );
  const [verify, verifyAction] = useActionState(
    verifySettlementAction,
    EMPTY_VERIFY,
  );

  const v = save.values ?? {};
  // The address as it now stands on the server. After a successful save the
  // action revalidates, so `address` is the new one; before that, what the
  // merchant typed is the better guess for the challenge.
  const current = v.settlement_address || address;

  // Verified is the SERVER's answer, but a verification that just succeeded in
  // this render has not necessarily propagated into props yet.
  const isVerified = verified || Boolean(verify.ok);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          label="Settlement address"
          hint="Every payment converts to one asset and lands here, on Monad."
        />

        <form action={saveAction} className="flex flex-col gap-5">
          <Field
            label="Monad address"
            name="settlement_address"
            required
            placeholder="0x…"
            defaultValue={v.settlement_address ?? address}
            error={save.fields?.settlement_address}
            hint="Chain 143. Starts 0x, 42 characters."
          />

          <Select
            label="Settle in"
            name="settlement_asset"
            defaultValue={v.settlement_asset || asset || "USDC"}
            error={save.fields?.settlement_asset}
            hint="Whatever the buyer sends, you receive this."
            options={[
              { value: "USDC", label: "USDC" },
              { value: "USDT", label: "USDT" },
              { value: "MON", label: "MON" },
            ]}
          />

          {save.message && <Note>{save.message}</Note>}
          {save.ok && <Note tone="ok">{save.ok}</Note>}

          <div>
            <Submit pendingLabel="Saving…">Save address</Submit>
          </div>

          {/* Said before they press the button, not after. Changing the
              address is what un-verifies it, and a merchant who learns that
              afterwards has already taken their own payments offline. */}
          <p className="border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
            Changing this address clears its verification. Payments cannot
            settle again until you prove you own the new one.
          </p>
        </form>
      </Card>

      <Card tone={isVerified ? "quiet" : undefined} marks={!isVerified}>
        <CardHeader
          label="Proof of control"
          hint="Sign a one-off message with the wallet above. Nothing is sent and no gas is spent."
        />

        {isVerified ? (
          <>
            <p className="text-[0.9375rem] leading-relaxed">
              <span aria-hidden="true" className="mr-1.5 text-sand">
                &#9632;
              </span>
              This address is verified. Payments settle to it.
            </p>
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
              You only need to do this again if you change the address.
            </p>
          </>
        ) : !current ? (
          <p className="text-[0.9375rem] leading-relaxed text-mute">
            Save a settlement address first, then verify it here.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-[0.9375rem] leading-relaxed">
              Until this is done, money has nowhere safe to land. Verifying
              proves the address belongs to you and not to someone who reached
              your account.
            </p>

            {/* Step one. */}
            {!challenge.message && (
              <form action={challengeAction}>
                <input type="hidden" name="address" value={current} />
                <Submit pendingLabel="Preparing…">Get a message to sign</Submit>
              </form>
            )}

            {challenge.error && <Note>{challenge.error}</Note>}

            {/* Step two. The message is rendered exactly as the API sent it. */}
            {challenge.message && (
              <>
                <div className="flex flex-col gap-2">
                  <p className="text-[0.875rem]">Sign this exact message</p>
                  <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-stone/60 px-3.5 py-2.5">
                    <code className="min-w-0 break-all font-mono text-[0.8125rem] leading-relaxed">
                      {challenge.message}
                    </code>
                    <CopyValue value={challenge.message} />
                  </div>
                  {challenge.expires_at && (
                    <p className="text-[0.8125rem] text-mute">
                      Expires <Timestamp value={challenge.expires_at} />.
                    </p>
                  )}
                </div>

                <form action={verifyAction} className="flex flex-col gap-5">
                  <input
                    type="hidden"
                    name="nonce"
                    value={challenge.nonce ?? ""}
                  />
                  <Field
                    label="Signature"
                    name="signature"
                    required
                    placeholder="0x…"
                    hint="Paste what your wallet gives back after signing."
                  />

                  {verify.error && <Note>{verify.error}</Note>}
                  {/* ⚠️ Rendered here as well as via the verified branch
                      above. `revalidatePath` refetches the merchant before
                      the new `verified` prop arrives, which measured at
                      ~5s against a local API — five seconds in which the
                      merchant has clicked Verify, succeeded, and is still
                      being told their money has nowhere to land. This
                      acknowledges the success immediately; the prop then
                      swaps the whole card over when it lands. */}
                  {verify.ok && <Note tone="ok">{verify.ok}</Note>}

                  <div>
                    <Submit pendingLabel="Verifying…">
                      Verify this address
                    </Submit>
                  </div>
                </form>
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
