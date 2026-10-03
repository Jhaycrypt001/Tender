"use client";

import { useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";

/**
 * Sign out of both sessions.
 *
 * Ending only OUR session would leave the person signed in to Privy, so the
 * sign-in page would sign them straight back in without asking. That is how a
 * shared computer stays open to the next person, so Privy is signed out first,
 * and then the form posts to `/app/signout` to clear ours.
 *
 * It stays a real form POST, as before: signing out changes state, and a GET
 * that mutates can be triggered by anything that prefetches links.
 */

type Props = { className?: string; role?: "menuitem" };

export function SignOutForm(props: Props) {
  // Privy's hooks only work inside its provider, which is only mounted when
  // sign-in is configured. Without it there is no Privy session to end.
  return process.env.NEXT_PUBLIC_PRIVY_APP_ID ? <WithPrivy {...props} /> : <Plain {...props} />;
}

function Plain({ className, role }: Props) {
  return (
    <form action="/app/signout" method="post">
      <button type="submit" role={role} className={className}>
        Sign out
      </button>
    </form>
  );
}

function WithPrivy({ className, role }: Props) {
  const { logout } = usePrivy();
  const form = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={form}
      action="/app/signout"
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        // Whatever happens at Privy, our own session must still end.
        await logout().catch(() => {});
        form.current?.submit();
      }}
    >
      <button type="submit" role={role} className={className}>
        Sign out
      </button>
    </form>
  );
}
