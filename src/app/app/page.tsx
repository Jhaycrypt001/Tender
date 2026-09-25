import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, decodeSession, isConfigured } from "@/lib/auth";
import { TenderMark } from "@/components/logo";
import { GoogleIcon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Sign in · Tender",
  description: "Sign in to your Tender merchant account.",
};

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled. Try again when you're ready.",
  bad_state: "That sign-in link expired. Please try again.",
  exchange_failed: "Google couldn't complete the sign-in. Please try again.",
  not_configured:
    "Google sign-in isn't connected yet. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.",
};

export default async function AppSignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // Already signed in — skip the card entirely.
  const jar = await cookies();
  if (decodeSession(jar.get(SESSION_COOKIE)?.value)) {
    redirect("/app/welcome");
  }

  const { error } = await searchParams;
  const message = error ? ERRORS[error] ?? ERRORS.exchange_failed : null;
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
            Accept any coin on 31+ chains and settle on Monad. Sign in to create
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

          {configured ? (
            <a
              href="/app/start"
              className="mt-7 flex w-full items-center justify-center gap-3 rounded-xl bg-ink px-6 py-4 font-mono text-[0.8125rem] tracking-[0.12em] text-paper transition-colors duration-300 hover:bg-ink/90"
            >
              <GoogleIcon className="h-[1.125rem] w-[1.125rem]" />
              CONTINUE WITH GOOGLE
            </a>
          ) : (
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
                Add your Google OAuth credentials to{" "}
                <code className="font-mono text-ink/70">.env.local</code> to
                enable sign-in.
              </p>
            </div>
          )}
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
