import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, decodeSession, isConfigured } from "@/lib/auth";
import { accountsEnabled } from "@/lib/api/server";
import { TenderMark } from "@/components/logo";
import SignInButton from "./sign-in-button";

export const metadata: Metadata = {
  title: "Sign in · Tender",
  description: "Sign in to your Tender merchant account.",
};

// Messages for `?error=` links. The sign-in button shows its own errors inline;
// these remain for any link that still arrives with one.
const ERRORS: Record<string, string> = {
  not_configured:
    "Sign-in isn't connected yet. Add NEXT_PUBLIC_PRIVY_APP_ID and PRIVY_APP_SECRET to .env.",
  account_unavailable:
    "You're signed in with Google, but we couldn't open your Tender account. Please try again in a moment.",
  signin_failed: "Sign-in didn't complete. Please try again.",
};

export default async function AppSignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in — skip the card entirely. A session from before accounts
  // were linked (no merchant id) is treated as signed out, so signing in again
  // replaces it with one that acts for the right merchant.
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  if (session && (session.merchantId || !accountsEnabled())) {
    redirect("/app/welcome");
  }

  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? ERRORS.signin_failed : null;
  const configured = isConfigured();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone px-5 py-16">
      <div className="relative w-full max-w-[26rem]">
        {/* Corner crosshairs, as on the dark panels elsewhere in the site. */}
        <Crosshair className="-left-1.5 -top-1.5" />
        <Crosshair className="-right-1.5 -top-1.5" />
        <Crosshair className="-bottom-1.5 -left-1.5" />
        <Crosshair className="-bottom-1.5 -right-1.5" />

        <div className="rounded-[20px] bg-paper px-8 py-10 shadow-[0_1px_2px_rgba(18,17,17,0.04),0_12px_32px_-12px_rgba(18,17,17,0.12)] md:px-10">
          <div className="flex items-center justify-center gap-3">
            <TenderMark className="h-7 w-7 text-ink" />
            <span className="rounded-full bg-sand/15 px-2.5 py-1 font-mono text-[0.625rem] tracking-[0.18em] text-sand">
              BETA
            </span>
          </div>

          <h1 className="mt-7 text-center font-display text-[2rem] leading-none">
            Tender
          </h1>

          <p className="mt-3 text-center font-mono text-[0.625rem] tracking-[0.18em] text-sand">
            MERCHANT ACCOUNT
          </p>

          <p className="mx-auto mt-6 max-w-[30ch] text-center text-[0.9375rem] leading-relaxed text-pretty text-ink/70">
            Accept any coin on 30 chains and settle on Monad. Sign in to create
            invoices and track settlement.
          </p>

          {message ? (
            <p
              role="alert"
              className="mt-6 rounded-xl bg-stone px-4 py-3 text-center text-[0.8125rem] leading-relaxed text-ink/75"
            >
              {message}
            </p>
          ) : null}

          <SignInButton configured={configured} />
        </div>
      </div>

      <p className="mt-8 text-center font-mono text-[0.625rem] tracking-[0.18em] text-ink/40">
        INVITE-ONLY BETA · BY TENDER
      </p>
    </main>
  );
}

function Crosshair({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute h-3 w-3 text-sand/50 ${className}`}
    >
      <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1">
        <path d="M6 0v12M0 6h12" />
      </svg>
    </span>
  );
}
