"use client";

import { useState } from "react";
import { howItWorks } from "@/lib/copy";
import { ArrowRightIcon } from "../icons";

/* The bento-card interaction, rebuilt on Tender's own tokens rather than
   dropped in from shadcn: this project has no `components/ui`, no `cn`, no
   CVA and its own Button, so importing the original would have pulled a
   second button system and a second palette in beside the existing one.
   The mechanic is what was asked for and the mechanic is what is kept —
   the stack lifts, the number shrinks back, and a CTA rises from under the
   bottom edge with a wash over the card.

   Driven by tap as well as hover, because on a touch screen there is no
   hover: `open` is the tapped card's index. Hover still works on a pointer
   device through the group-hover variants, so a desktop visitor gets the
   same motion without having to click first. */
export default function HowItWorks() {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section id="how-it-works" className="section-y">
      <div className="shell">
        <h2 className="max-w-[18ch] text-balance">{howItWorks.heading}</h2>

        <ol className="mt-14 grid gap-px overflow-hidden rounded-[20px] border border-line bg-line md:grid-cols-3">
          {howItWorks.steps.map((step) => {
            const isOpen = open === step.n;

            // `flex` on the li so the button fills the row: the cards have
            // unequal body lengths, and without it each button only wraps its
            // own text and the three numbers stop sharing a baseline.
            return (
              <li key={step.n} className="flex bg-paper">
                {/* A button, not a div: tapping it is a real interaction, so it
                    has to be reachable by keyboard and announce its state. */}
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : step.n)}
                  aria-expanded={isOpen}
                  className="group relative w-full self-stretch overflow-hidden p-8 text-left md:p-10"
                >
                  {/* The body lifts to make room for the CTA sliding in under
                      it. 2.5rem is the CTA's own height, so the two move as
                      one piece instead of overlapping. */}
                  <div
                    className={`relative z-10 transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:-translate-y-10 motion-reduce:transform-none motion-reduce:transition-none ${
                      isOpen ? "-translate-y-10" : ""
                    }`}
                  >
                    <span
                      className={`block origin-left font-display text-2xl text-sand transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:scale-75 motion-reduce:transform-none motion-reduce:transition-none ${
                        isOpen ? "scale-75" : ""
                      }`}
                    >
                      {step.n}
                    </span>
                    <h3 className="mt-6">{step.title}</h3>
                    <p className="mt-3 text-[0.9375rem] text-pretty text-ink/70">
                      {step.body}
                    </p>
                  </div>

                  {/* Starts below the bottom edge and rises into place. */}
                  <span
                    className={`pointer-events-none absolute inset-x-8 bottom-8 z-10 inline-flex translate-y-10 items-center gap-2 text-[0.9375rem] font-medium text-ink opacity-0 transition-all duration-500 ease-[var(--ease-out-expo)] group-hover:translate-y-0 group-hover:opacity-100 motion-reduce:transition-none md:inset-x-10 md:bottom-10 ${
                      isOpen ? "translate-y-0 opacity-100" : ""
                    }`}
                  >
                    Read the docs
                    <ArrowRightIcon className="h-4 w-4 text-sand" />
                  </span>

                  {/* The wash. Stone rather than black at 3% so it reads as
                      the same warm grey the rest of the page uses. */}
                  <span
                    aria-hidden
                    className={`pointer-events-none absolute inset-0 bg-stone/60 opacity-0 transition-opacity duration-500 group-hover:opacity-100 motion-reduce:transition-none ${
                      isOpen ? "opacity-100" : ""
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
