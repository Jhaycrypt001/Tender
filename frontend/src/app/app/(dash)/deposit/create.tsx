"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CTA_CLASS } from "@/components/dash/cta";
import { createDepositAddressAction, type DepositState } from "./actions";

const EMPTY: DepositState = {};

/** The one button that mints the standing address, then reloads the page so it shows. */
export function CreateDepositAddress() {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    async (_prev: DepositState) => createDepositAddressAction(),
    EMPTY,
  );

  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <form action={action}>
      <button
        type="submit"
        disabled={pending}
        className={`${CTA_CLASS} bg-ink text-paper hover:bg-ink/88 disabled:opacity-60`}
      >
        {pending ? "Creating…" : "Get my deposit address"}
      </button>
      {state.message && (
        <p role="alert" className="mt-3 text-[0.8125rem] text-ink">
          {state.message}
        </p>
      )}
    </form>
  );
}
