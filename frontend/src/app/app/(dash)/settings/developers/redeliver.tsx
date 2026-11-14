"use client";

import { useActionState } from "react";
import { Submit } from "@/components/dash/action";
import {
  redeliverAction,
  type RedeliverState,
} from "@/app/app/(dash)/settings/developers/actions";

const EMPTY: RedeliverState = {};

/**
 * Send a failed webhook again. Only offered on a delivery Tender has given up on:
 * the server refuses one that already arrived, so this is a convenience, not the
 * guard. The payload, and the event id in it, is unchanged, so a receiver that
 * dedupes on the id handles the repeat safely.
 */
export function RedeliverButton({ id }: { id: string }) {
  const [state, action] = useActionState(redeliverAction, EMPTY);

  return (
    <form action={action} className="mt-1.5 flex flex-col items-start gap-1">
      <input type="hidden" name="id" value={id} />
      <Submit variant="quiet" pendingLabel="Queuing…">
        Send again
      </Submit>
      {state.ok && <span role="status" className="text-[0.75rem] text-mute">{state.ok}</span>}
      {state.error && <span role="alert" className="text-[0.75rem] text-ink">{state.error}</span>}
    </form>
  );
}
