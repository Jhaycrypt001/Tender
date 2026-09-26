"use client";

import { useEffect, useReducer } from "react";
import { useRouter } from "next/navigation";
import { TenderMark } from "@/components/logo";

/**
 * The post-sign-in transition.
 *
 * Two acts: the mark rolls in from the left and settles beside the wordmark,
 * then the panel swaps to a confirmation. The steps below are named honestly —
 * each one is a real thing that happens when an account is created, so the
 * wait describes itself rather than showing a spinner over a fixed delay.
 */

const STEPS = [
  "Signing you in",
  "Creating your merchant account",
  "Setting up your workspace",
] as const;

/** Milliseconds each step is shown. The first beat covers the 1.5s roll-in,
 *  so the confirmation never lands on top of the mark still travelling. */
const STEP_MS = 900;

/** How long "You're all set" holds before the dashboard takes over. Long
 *  enough to read, short enough not to feel like a stall. */
const HANDOFF_MS = 1100;

type State = { step: number; done: boolean };

function reducer(state: State): State {
  if (state.step < STEPS.length - 1) return { ...state, step: state.step + 1 };
  return { ...state, done: true };
}

export default function Welcome({ name }: { name: string }) {
  const [state, advance] = useReducer(reducer, { step: 0, done: false });
  const router = useRouter();

  useEffect(() => {
    if (state.done) return;
    const timer = setTimeout(advance, STEP_MS);
    return () => clearTimeout(timer);
  }, [state.step, state.done]);

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
