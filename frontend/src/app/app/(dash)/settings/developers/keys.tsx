"use client";

import { useActionState, useState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { ReadOnlyField } from "@/components/dash/field";
import { Action, Submit } from "@/components/dash/action";
import { CopyValue } from "@/components/dash/copy";
import { Timestamp } from "@/components/dash/money";
import type { ApiKeySummary } from "@/lib/api/types";
import {
  createKeyAction,
  revokeKeyAction,
  type CreateKeyState,
  type RevokeKeyState,
} from "@/app/app/(dash)/settings/developers/actions";

/**
 * The merchant's own API keys, for calling Tender from their server.
 *
 * ⚠️ A new key is shown ONCE, right here, from the create action's response.
 * It is never written to a cookie, local storage or the URL, and a reload
 * loses it for good: only its hash exists on the server. That is the point,
 * and the panel says so before the merchant can lose it.
 *
 * These keys are not what this dashboard uses. The dashboard acts through the
 * platform key on our server, so revoking every key here never locks the
 * merchant out of the dashboard; it only stops their own integration.
 */

/** Matches the backend's cap on active keys. */
const MAX_KEYS = 10;

const EMPTY_CREATE: CreateKeyState = {};
const EMPTY_REVOKE: RevokeKeyState = {};

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

/**
 * One key row. Revoking is two steps on purpose: it breaks the merchant's
 * integration the moment it lands, so it must never be one stray tap. The
 * confirmation is inline rather than a browser dialog, which would block the
 * page and cannot be styled to say what will break.
 */
function KeyRow({ k }: { k: ApiKeySummary }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action] = useActionState(revokeKeyAction, EMPTY_REVOKE);

  return (
    <li className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <code className="font-mono text-[0.875rem] text-ink">{k.prefix}…</code>
          <p className="mt-1 text-[0.8125rem] text-mute">
            Created <Timestamp value={k.created_at} dateOnly /> ·{" "}
            {k.last_used_at ? (
              <>
                last used <Timestamp value={k.last_used_at} />
              </>
            ) : (
              "never used"
            )}
          </p>
        </div>
        {!confirming && (
          <Action variant="quiet" onClick={() => setConfirming(true)} ariaLabel={`Revoke ${k.prefix}`}>
            Revoke
          </Action>
        )}
      </div>

      {confirming && (
        <form action={action} className="flex flex-col gap-3 rounded-xl border border-line bg-stone/60 p-3.5">
          <input type="hidden" name="id" value={k.id} />
          <p className="text-[0.875rem] leading-relaxed">
            Revoke <code className="font-mono">{k.prefix}…</code>? Any server
            still using it starts getting 401 at once. Deploy a new key first if
            this one is live.
          </p>
          <div className="flex flex-wrap gap-2">
            <Submit variant="danger" pendingLabel="Revoking…">
              Revoke key
            </Submit>
            <Action variant="quiet" onClick={() => setConfirming(false)}>
              Keep it
            </Action>
          </div>
        </form>
      )}

      {state.error && <Note>{state.error}</Note>}
    </li>
  );
}

export function ApiKeysPanel({ keys }: { keys: ApiKeySummary[] }) {
  const [create, createAction] = useActionState(createKeyAction, EMPTY_CREATE);
  const atCap = keys.length >= MAX_KEYS;

  return (
    <Card>
      <CardHeader
        label="API keys"
        hint="For your own server. Send Authorization: Bearer tk_live_… on every request."
      />

      {create.created && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-sand/40 bg-sand/[0.06] p-4">
          <ReadOnlyField label="Your new key" action={<CopyValue value={create.created.key} />}>
            <code className="font-mono text-[0.8125rem]">{create.created.key}</code>
          </ReadOnlyField>
          <p className="text-[0.8125rem] leading-relaxed text-ink">
            Copy it now. This is the only time it is shown: Tender keeps only
            a hash, so it cannot be shown again. Lose it and you create another.
          </p>
        </div>
      )}

      {keys.length === 0 ? (
        <p className="mb-5 text-[0.875rem] leading-relaxed text-mute">
          No keys yet. You only need one if your own server calls Tender, for
          example to create invoices from your checkout.
        </p>
      ) : (
        <ul className="mb-5">
          {keys.map((k) => (
            <KeyRow key={k.id} k={k} />
          ))}
        </ul>
      )}

      <form action={createAction} className="flex flex-col gap-3 border-t border-line pt-5">
        {create.error && <Note>{create.error}</Note>}
        {atCap && (
          <p className="text-[0.8125rem] leading-relaxed text-mute">
            You have {MAX_KEYS} active keys, the most allowed. Revoke one you no
            longer use to create another.
          </p>
        )}
        <div>
          <Submit pendingLabel="Creating…" disabled={atCap}>
            Create key
          </Submit>
        </div>
        <p className="text-[0.8125rem] leading-relaxed text-mute">
          To rotate without downtime: create a new key, deploy it, then revoke
          the old one.
        </p>
      </form>
    </Card>
  );
}
