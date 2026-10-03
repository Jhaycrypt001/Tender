"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { TenderMark } from "@/components/logo";
import { useSettlementSetup } from "@/lib/use-settlement-setup";

/**
 * The post-sign-in setup.
 *
 * Two acts: the mark rolls in from the left and settles beside the wordmark,
 * then the panel swaps to a confirmation. The steps are real: each one
 * advances when the thing it names has actually happened, so the wait
 * describes itself instead of running a spinner over a fixed delay.
 *
 *   0. Signing you in: the Tender session already exists (the sign-in page made it).
 *   1. Creating your wallet: Privy made it at sign-in; this confirms it is there.
 *   2. Securing your settlement address: the wallet is saved as the place
 *      payments land, and it signs a one-off message proving it is yours.
 *
 * If a step fails the screen says so and offers a retry. It never hangs, and
 * never claims "all set" for an address that is not verified.
 */

const STEPS = [
  "Signing you in",
  "Creating your wallet",
  "Securing your settlement address",
] as const;

/** Each step is shown at least this long, so a fast one is still readable. The
 *  first also covers the 1.5s roll-in, so the confirmation never lands on top
 *  of the mark still travelling. */
const MIN_STEP_MS = 900;

/** How long "You're all set" holds before the dashboard takes over. Long
 *  enough to read, short enough not to feel like a stall. */
const HANDOFF_MS = 1100;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type State = { step: number; done: boolean; error: string };

export default function Welcome({ name }: { name: string }) {
  const [state, setState] = useState<State>({ step: 0, done: false, error: "" });
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  const { ready, authenticated } = usePrivy();
  const runSetup = useSettlementSetup();
  // One run per attempt. Without it, React's dev double-mount would start two
  // setups and the second would replace the first's one-off message.
  const ran = useRef(-1);

  useEffect(() => {
    if (!ready || state.done) return;
    if (!authenticated) {
      // Keep the same state object once the message is set, so this branch
      // cannot re-render itself in a loop.
      setState((s) =>
        s.error ? s : { step: 0, done: false, error: "Your sign-in session ended. Please sign in again." },
      );
      return;
    }
    if (ran.current === attempt) return;
    ran.current = attempt;

    void (async () => {
      setState({ step: 0, done: false, error: "" });
      let shownAt = Date.now();
      // Holds the step on screen for at least MIN_STEP_MS before the next one.
      const hold = () => sleep(Math.max(0, MIN_STEP_MS - (Date.now() - shownAt)));

      // The setup reports each step as it reaches it, and waits for us.
      const failure = await runSetup(async (step) => {
        await hold();
        shownAt = Date.now();
        setState((s) => ({ ...s, step: step === "wallet" ? 1 : 2 }));
      });
      if (failure) {
        setState((s) => ({ ...s, error: failure }));
        return;
      }
      await hold();
      setState({ step: STEPS.length - 1, done: true, error: "" });
    })();
  }, [ready, authenticated, attempt, state.done, runSetup]);

  // Hand off to the dashboard once the confirmation has been seen. `replace`
  // rather than `push`, so Back returns to wherever they came from instead of
  // replaying this transition.
  useEffect(() => {
    if (!state.done) return;
    const timer = setTimeout(() => router.replace("/app/home"), HANDOFF_MS);
    return () => clearTimeout(timer);
  }, [state.done, router]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-stone px-5">
      {/* Act one: the mark rolls left to right, then the wordmark fades in
          beside it. Both are CSS animations rather than JS so they start on
          the first paint with no flash of unstyled position. */}
      <div className="flex items-center gap-3">
        <TenderMark className="tender-roll h-8 w-8 text-ink" />
        <span className="tender-wordmark font-display text-[1.75rem] leading-none">
          tender
        </span>
      </div>

      <div className="mt-16 flex flex-col items-center">
        {state.done ? (
          <>
            <div className="tender-pop flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl bg-sand">
              <CheckIcon className="h-8 w-8 text-paper" />
            </div>
            <h1 className="tender-rise mt-7 font-display text-[1.5rem] leading-none">
              You&rsquo;re all set
            </h1>
            <p className="tender-rise mt-3 text-[0.9375rem] text-ink/60">
              Welcome, {name}.
            </p>
          </>
        ) : state.error ? (
          <>
            <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl border border-line bg-paper">
              <TenderMark className="h-7 w-7 text-ink/25" />
            </div>
            <h1 className="tender-rise mt-7 font-display text-[1.5rem] leading-none">
              Almost there
            </h1>
            <p
              role="alert"
              className="tender-rise mt-3 max-w-[32ch] text-center text-[0.9375rem] leading-relaxed text-ink/70"
            >
              {state.error}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setAttempt((n) => n + 1)}
                className="rounded-xl bg-ink px-5 py-3 font-mono text-[0.75rem] tracking-[0.12em] text-paper transition-colors hover:bg-ink/90"
              >
                TRY AGAIN
              </button>
              {/* The merchant can still look around; Settings shows that the
                  wallet is not verified yet and lets them finish it. */}
              <Link
                href="/app/home"
                className="rounded-xl border border-line bg-paper px-5 py-3 font-mono text-[0.75rem] tracking-[0.12em] text-ink transition-colors hover:border-mute/50"
              >
                CONTINUE ANYWAY
              </Link>
            </div>
          </>
        ) : (
          <>
            <div className="flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-2xl border border-line bg-paper">
              <TenderMark className="h-7 w-7 animate-pulse text-ink/25" />
            </div>
            <p
              key={state.step}
              aria-live="polite"
              className="tender-rise mt-7 text-[0.9375rem] text-ink/70"
            >
              {STEPS[state.step]}
            </p>
          </>
        )}

        {/* Progress rail, one dash per step, driven by real step
            state rather than looping on its own. */}
        <div className="mt-8 flex gap-2">
          {STEPS.map((_, i) => {
            const filled = state.done || i <= state.step;
            return (
              <span
                key={i}
                className={`h-[3px] w-6 rounded-full transition-colors duration-500 ${
                  filled ? "bg-sand" : "bg-ink/12"
                }`}
              />
            );
          })}
        </div>
      </div>
    </main>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 12.5 5.5 5.5L20 7" />
    </svg>
  );
}
