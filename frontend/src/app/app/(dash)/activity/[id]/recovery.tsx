"use client";

import { useActionState } from "react";
import { Submit } from "@/components/dash/action";
import {
  recoverPaymentAction,
  type RecoveryState,
} from "@/app/app/(dash)/activity/actions";

const EMPTY: RecoveryState = {};

/**
 * The two ways out of NEEDS_RECOVERY.
 *
 * One form, two submit buttons carrying `name="intent"`, so the server reads
 * which one fired. That keeps this working before hydration: a native form
 * submit sends the clicked button's value, no JavaScript involved.
 *
 * ⚠️ Retry is the quiet button and withdraw is the loud one, which is the
 * opposite of how it looks. Retry is the cheap, reversible attempt — try
 * settling again. Withdraw is the exit: it gives up on settling. The heavier
 * styling belongs on the one that ends the attempt.
 *
 * ⚠️ "Request withdrawal", never "Withdraw to my address": Aurora has no
 * withdrawal API for deposit addresses, so Tender cannot move these funds
 * itself. The backend records the destination and attaches a ready-to-file
 * Aurora support case to the payment's recovery notes; the task stays OPEN
 * until Aurora completes it. A label promising instant funds would be a lie.
 */
export function RecoveryActions({
  paymentId,
  /** Rendered as-is — it is the backend's reason, not ours to reword. */
  reason,
  state: taskState,
}: {
  paymentId: string;
  reason: string;
  state: string;
}) {
  const [state, action] = useActionState(recoverPaymentAction, EMPTY);

  // Once a route out has been taken, the buttons would only start a second
  // one. The state is shown instead, because the merchant still needs to know
  // something is in flight.
  const settled = taskState === "WITHDRAWN" || taskState === "RESOLVED";

  return (
    <form action={action}>
      <input type="hidden" name="payment_id" value={paymentId} />

      <p className="text-[0.875rem] leading-relaxed">
        The deposit arrived, but settling it onward did not complete. The funds
        are not lost and they are not refunded automatically. Try settling
        again, or request a withdrawal: Tender prepares the support case for
        Aurora with your settlement address, and this payment stays open until
        Aurora completes it.
      </p>

      <p className="mt-3 rounded-xl border border-paper/12 bg-paper/[0.06] px-3.5 py-2.5 font-mono text-[0.75rem] leading-relaxed">
        {reason}
      </p>

      {state.message && (
        <p role="alert" className="mt-4 text-[0.875rem] leading-relaxed">
          <span aria-hidden="true" className="mr-1.5 text-sand">
            &#9632;
          </span>
          {state.message}
        </p>
      )}

      {state.ok && (
        <p role="status" className="mt-4 text-[0.875rem] leading-relaxed">
          <span aria-hidden="true" className="mr-1.5 text-sand">
            &#9632;
          </span>
          {state.ok}
        </p>
      )}

      {settled ? (
        <p className="mt-4 text-[0.875rem] leading-relaxed text-paper/60">
          This has already been resolved. Nothing further is needed.
        </p>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Submit
            name="intent"
            value="retry"
            pendingLabel="Retrying…"
            className="border border-paper/25 bg-transparent text-paper hover:bg-paper/10 disabled:text-paper/40"
          >
            Try settling again
          </Submit>
          <Submit
            name="intent"
            value="withdraw"
            pendingLabel="Requesting…"
            className="bg-sand text-ink hover:bg-sand/90 disabled:bg-sand/40"
          >
            Request withdrawal
          </Submit>
        </div>
      )}
    </form>
  );
}
