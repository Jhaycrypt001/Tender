"use server";

import { refundPayment } from "@/lib/api/payments";

/**
 * Outbound money.
 *
 * ⚠️ Only refund exists here, and that is not an oversight — it is the whole
 * of what the §5 contract supports. There is no payout endpoint and no split
 * endpoint, so those two screens stay honest placeholders rather than forms
 * that collect an address and an amount and then have nowhere to send them. A
 * send button that cannot send is worse than no send button: the merchant
 * believes money moved.
 */

export type RefundState = {
  message?: string;
  ok?: string;
  /** The payment the last attempt targeted, so the screen can stay on it. */
  paymentId?: string;
};

/**
 * Refund one settled payment, in full, to the address that sent it.
 *
 * ⚠️ Two things this deliberately does NOT do:
 *
 * 1. It takes no amount. `refundPayment(id)` has no amount parameter — the
 *    API refunds the payment, whole. Offering a partial-amount field would
 *    collect a number the request cannot carry, and the merchant would watch
 *    a full refund leave after typing half of one.
 *
 * 2. It takes no destination. The refund goes back along the path the money
 *    arrived on. A free-form address field on a refund screen is how a
 *    support-desk social-engineering attack gets paid; the plan is explicit
 *    that refund "must link back to the originating payment, never be a
 *    free-form send".
 */
export async function refundAction(
  _prev: RefundState,
  form: FormData,
): Promise<RefundState> {
  const paymentId = String(form.get("payment_id") ?? "").trim();

  if (!paymentId) {
    return { message: "Pick the payment you want to refund." };
  }



  const result = await refundPayment(paymentId);

  if (!result.ok) {
    const { error } = result;
    if (error.kind === "not_configured") {
      return {
        paymentId,
        message:
          "Refunds cannot be sent yet — the Tender API is not connected in this environment.",
      };
    }
    return { paymentId, message: error.message };
  }

  // ⚠️ Deliberately NOT revalidating "/app/pay/refund" — this page.
  //
  // Doing so refetches the settled-payments list, the refunded payment drops
  // out of it, RefundForm receives a different `payments` prop, and the
  // remount takes `useActionState` with it. Measured over 20s: the success
  // message never painted once, and the button re-disabled because the radio
  // WARNING: do NOT call revalidatePath here. It costs the merchant the
  // only confirmation they get that their money went back.
  //
  // Measured on one build, toggling revalidation alone:
  //
  //     revalidation OFF -> confirmation renders in 6.3s
  //     revalidation ON  -> never renders, not once in 150 samples at 100ms
  //
  // A revalidate from inside a server action refreshes the router, and that
  // refresh discards the value `useActionState` is holding before it can
  // paint. The failure path, which revalidates nothing, has always rendered
  // its message in ~300ms; that asymmetry is what gave this away. A ref-based
  // latch does not survive it either, because the refresh remounts the tree.
  //
  // So the refund confirms in place, and the other screens pick the change up
  // on their own next load. Those screens are `force-dynamic` and fetch fresh
  // on every visit, so nothing there is stale by the time it is read — the
  // revalidations were buying nothing and costing the one message that says
  // the money moved.

  return {
    paymentId,
    ok: "Refund sent. It appears in Activity as a refunded payment.",
  };
}
