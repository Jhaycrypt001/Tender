"use server";

import { createDepositAddress } from "@/lib/api/deposit";

/**
 * Getting the standing deposit address.
 *
 * ⚠️ No revalidatePath, for the reason documented in `links/actions.ts`: a
 * revalidate from inside a server action refreshes the router and destroys the
 * state `useActionState` is holding before it paints. The page refreshes itself
 * from the client once this has returned.
 */
export type DepositState = { ok?: boolean; message?: string };

export async function createDepositAddressAction(): Promise<DepositState> {
  const result = await createDepositAddress();
  if (result.ok) return { ok: true };

  const { error } = result;
  if (error.kind === "not_configured") {
    return { message: "The deposit address cannot be created yet: the Tender API is not connected in this environment." };
  }
  return { message: error.message };
}
