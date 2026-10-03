"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getIdentityToken,
  useCreateWallet,
  useIdentityToken,
  useLogin,
  usePrivy,
} from "@privy-io/react-auth";
import { GoogleIcon } from "@/components/icons";

/**
 * The sign-in button.
 *
 * Privy handles the Google login (in its own popup) and creates the merchant's
 * wallet. Once it says they are signed in, `establish` hands Privy's identity
 * token to our server, which verifies it and starts the Tender session. Only
 * then does the browser move on to the welcome step.
 *
 * ⚠️ Gentle with Privy's API. Fetching the token (`getIdentityToken`) is a
 * network call to Privy, which rate-limits (429). So the token is read from
 * Privy's own state (`useIdentityToken`) and fetched at most twice per attempt,
 * one attempt runs at a time, and nothing runs on page load by itself: Privy's
 * "login complete" event also fires on every load for someone already signed in
 * to Privy, and acting on that turned every refresh into another round.
 *
 * The button is two components on purpose. Privy's hooks only work inside its
 * provider, which is not mounted when sign-in is not configured, so that case
 * is a separate, hook-free component that says so plainly.
 */

const BUTTON =
  "mt-7 flex w-full items-center justify-center gap-3 rounded-xl bg-ink px-6 py-4 font-mono text-[0.8125rem] tracking-[0.12em] text-paper transition-colors duration-300 hover:bg-ink/90 disabled:cursor-wait disabled:bg-ink/40";

const MESSAGES: Record<string, string> = {
  invalid_token: "We couldn't verify your sign-in. Please try again.",
  missing_token: "We couldn't verify your sign-in. Please try again.",
  identity_token_missing:
    "Sign-in isn't fully set up yet, so we couldn't confirm who you are. Please try again later.",
  account_unavailable:
    "You're signed in with Google, but we couldn't open your Tender account. Please try again in a moment.",
  wallet_pending: "Your wallet isn't ready yet. Please try again in a moment.",
  not_configured: "Sign-in isn't set up in this environment yet.",
};

const GENERIC = "Sign-in didn't complete. Please try again.";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function SignInButton({ configured }: { configured: boolean }) {
  if (!configured) {
    return (
      <div className="mt-7">
        <button
          type="button"
          disabled
          className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-xl bg-ink/30 px-6 py-4 font-mono text-[0.8125rem] tracking-[0.12em] text-paper"
        >
          <GoogleIcon className="h-[1.125rem] w-[1.125rem]" />
          CONTINUE WITH GOOGLE
        </button>
        <p className="mt-3 text-center text-[0.75rem] leading-relaxed text-ink/50">
          Add <code className="font-mono text-ink/70">NEXT_PUBLIC_PRIVY_APP_ID</code>{" "}
          and <code className="font-mono text-ink/70">PRIVY_APP_SECRET</code> to{" "}
          <code className="font-mono text-ink/70">.env</code> to enable sign-in.
        </p>
      </div>
    );
  }
  return <LiveButton />;
}

function LiveButton() {
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { createWallet } = useCreateWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The latest token Privy holds, readable inside an async flow without a fetch.
  const tokenRef = useRef<string | null>(identityToken);
  useEffect(() => {
    tokenRef.current = identityToken;
  }, [identityToken]);

  // One attempt at a time: a double click must not start two.
  const running = useRef(false);

  /** Waits up to `ms` for Privy to hold a token, reading its state, not the network. */
  const waitForToken = useCallback(async (ms: number) => {
    for (let waited = 0; waited < ms && !tokenRef.current; waited += 250) await sleep(250);
    return tokenRef.current;
  }, []);

  const post = (token: string) =>
    fetch("/app/session", { method: "POST", headers: { "x-privy-identity-token": token } });

  /**
   * Starts the Tender session from the Privy sign-in. Returns null on success,
   * or an error code from MESSAGES.
   */
  const establish = useCallback(async (): Promise<string | null> => {
    // Use the token Privy already holds; if it has none yet, ask for one at once
    // instead of sitting and waiting. Only if that also comes back empty, give
    // Privy's own state a short moment to catch up before giving up.
    let token =
      tokenRef.current ?? (await getIdentityToken()) ?? (await waitForToken(2000));
    if (!token) {
      console.error(
        "[tender] Privy returned no identity token. Turn on \"Return user data in an identity token\" " +
          "in the Privy dashboard (User management → Authentication → Advanced).",
      );
      return "identity_token_missing";
    }

    let res = await post(token);

    // The wallet is created at login but can land after the first token: create
    // it if it is missing, then fetch one fresh token and try once more.
    if (res.status === 409) {
      await createWallet().catch(() => {}); // throws if it already exists: fine
      await sleep(1500);
      token = await getIdentityToken();
      if (token) res = await post(token);
    }

    if (res.ok) return null;
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    return body.error ?? "failed";
  }, [createWallet, waitForToken]);

  const finish = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const failure = await establish();
    if (failure) {
      setError(MESSAGES[failure] ?? GENERIC);
      setBusy(false);
      running.current = false;
      return;
    }
    // Stay busy: the button must not come back to life mid-navigation.
    router.replace("/app/welcome");
  }, [establish, router]);

  const { login } = useLogin({
    // Only a login that just happened. For someone already signed in to Privy
    // this fires on every page load, and acting on it would loop.
    onComplete: ({ wasAlreadyAuthenticated }) => {
      if (!wasAlreadyAuthenticated) void finish();
    },
    onError: (code) => {
      // Closing the popup is not a failure worth a message.
      if (code === "exited_auth_flow") return;
      setError(GENERIC);
      setBusy(false);
    },
  });

  return (
    <>
      <button
        type="button"
        disabled={!ready || busy}
        onClick={() => {
          setError("");
          // Already signed in to Privy (a returning visitor whose Tender
          // session lapsed): skip the popup and just start the session.
          if (authenticated) void finish();
          else login();
        }}
        className={BUTTON}
      >
        <GoogleIcon className="h-[1.125rem] w-[1.125rem]" />
        {busy ? "SIGNING YOU IN…" : "CONTINUE WITH GOOGLE"}
      </button>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-stone px-4 py-3 text-center text-[0.8125rem] leading-relaxed text-ink/75"
        >
          {error}
        </p>
      ) : null}
    </>
  );
}
