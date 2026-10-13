"use client";

import { useActionState } from "react";
import { Card, CardHeader } from "@/components/dash/card";
import { Submit } from "@/components/dash/action";
import { saveEmailPrefsAction, type SettlementState } from "./actions";

const EMPTY: SettlementState = {};

/**
 * Email. One switch: a receipt for each payment received. Emails for money sent out
 * are always on, because they are also how an owner finds out something left the wallet.
 */
export function EmailPanel({ payIn }: { payIn: boolean }) {
  const [state, action] = useActionState(saveEmailPrefsAction, EMPTY);

  return (
    <Card tone="quiet">
      <CardHeader label="Emails" hint="Sent to the address you signed in with." />
      <form action={action} className="flex flex-col gap-4">
        <label className="flex items-start gap-3 text-[0.875rem]">
          <input type="checkbox" name="email_pay_in" defaultChecked={payIn} className="mt-1 h-4 w-4 accent-[#121111]" />
          <span>
            Payment received
            <span className="block text-[0.8125rem] text-mute">One email for each payment that lands in your wallet.</span>
          </span>
        </label>
        <p className="text-[0.8125rem] leading-relaxed text-mute">
          Money you send out (payments, refunds, splits) is always emailed, so you know if anything leaves your wallet.
        </p>
        {state.message && <p role="alert" className="text-[0.875rem]">{state.message}</p>}
        {state.ok && <p role="status" className="text-[0.875rem]">{state.ok}</p>}
        <div>
          <Submit pendingLabel="Saving…">Save</Submit>
        </div>
      </form>
    </Card>
  );
}
