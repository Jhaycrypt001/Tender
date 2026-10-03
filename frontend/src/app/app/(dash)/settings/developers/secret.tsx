"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { ReadOnlyField } from "@/components/dash/field";
import { Action, Submit } from "@/components/dash/action";
import { CopyValue } from "@/components/dash/copy";
import {
  rotateSecretAction,
  type RotateSecretState,
} from "@/app/app/(dash)/settings/developers/actions";

/**
 * The webhook signing secret.
 *
 * ⚠️ There is no "show my secret" here, by design: it is shown once, when it is
 * made, and the merchant's server is the only other place it lives. Rotating
 * replaces it immediately, so every delivery after that fails verification on
 * a server that still has the old one. Hence two steps, and a warning that
 * says exactly that before anything changes.
 */

const EMPTY: RotateSecretState = {};

export function SigningSecretPanel() {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(rotateSecretAction, EMPTY);

  return (
    <Card>
      <CardHeader
        label="Signing secret"
        hint="Your server uses it to check a delivery really came from Tender."
      />

      {state.secret ? (
        <div className="flex flex-col gap-3 rounded-xl border border-sand/40 bg-sand/[0.06] p-4">
          <ReadOnlyField label="Your new signing secret" action={<CopyValue value={state.secret} />}>
            <code className="font-mono text-[0.8125rem]">{state.secret}</code>
          </ReadOnlyField>
          <p className="text-[0.8125rem] leading-relaxed text-ink">
            Copy it into your server now. It is not shown again, and the old
            secret has already stopped working.
          </p>
        </div>
      ) : confirming ? (
        <form action={action} className="flex flex-col gap-3 rounded-xl border border-line bg-stone/60 p-3.5">
          <p className="text-[0.875rem] leading-relaxed">
            Rotate now? The current secret stops working the moment you do, so
            deliveries fail verification until your server has the new one. Be
            ready to update it straight away.
          </p>
          <div className="flex flex-wrap gap-2">
            <Submit variant="danger" pendingLabel="Rotating…">
              Rotate secret
            </Submit>
            <Action variant="quiet" onClick={() => setConfirming(false)}>
              Cancel
            </Action>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[0.875rem] leading-relaxed text-mute">
            Rotate it if it may have leaked. The new one is shown once.
          </p>
          <div>
            <Action variant="quiet" onClick={() => setConfirming(true)}>
              Rotate signing secret
            </Action>
          </div>
        </div>
      )}

      {state.error && (
        <p role="alert" className="mt-3 text-[0.875rem] leading-relaxed text-ink">
          <span aria-hidden="true" className="mr-1.5 text-sand">
            &#9632;
          </span>
          {state.error}
        </p>
      )}
    </Card>
  );
}
