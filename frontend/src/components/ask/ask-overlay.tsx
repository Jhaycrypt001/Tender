"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TenderMark } from "@/components/logo";
import { CloseIcon } from "@/components/dash/icons";
import MorphOrb, { type MorphOrbHandle, type MorphPhase } from "@/components/ui/ai-thinking-orb";
import { askTender } from "@/app/app/(dash)/ask/actions";
import { QUESTIONS } from "@/lib/ask";
import { Mascot } from "./mascot";
import "./ask.css";

/**
 * The Ask assistant: a full-screen layer over whatever dashboard screen the
 * merchant is on. Opening it never navigates.
 *
 * The intro, in order (≈2.7s, skippable by click or any key):
 *   1. the mascot hops in from off-screen left, squashing on each landing;
 *   2. it stops at centre stage and smiles — shockwave, sparks, a warm flash;
 *   3. it glides into its resting spot above the greeting, and the greeting,
 *      the suggestions and the MorphOrb pill rise in around it.
 * With reduced motion the mascot simply appears, smiling, already in place.
 *
 * Suggested questions are answered exactly from live payments; anything typed
 * goes to the backend assistant via `askTender` (see docs/ASSISTANT.md).
 */

/** Intro size of the mascot; at rest it is scaled down to SLOT. */
const BIG = 132;
const SLOT = 76;
const REST_SCALE = SLOT / BIG;

const IN = "cubic-bezier(0.55, 0, 1, 0.45)";
const OUT = "cubic-bezier(0, 0.55, 0.45, 1)";
const SNAP = "cubic-bezier(0.2, 0.9, 0.3, 1)";

/* Three hops of falling height, squash on landing, lean forward in the air. */
const HOP: Keyframe[] = [
  { offset: 0, transform: "translateY(-70px) scale(0.95, 1.05) rotate(7deg)", easing: IN },
  { offset: 0.16, transform: "translateY(0) scale(1.24, 0.76) rotate(0deg)", easing: SNAP },
  { offset: 0.22, transform: "translateY(-44px) scale(0.93, 1.08) rotate(5deg)", easing: OUT },
  { offset: 0.38, transform: "translateY(-130px) scale(0.97, 1.03) rotate(8deg)", easing: IN },
  { offset: 0.54, transform: "translateY(0) scale(1.22, 0.78) rotate(0deg)", easing: SNAP },
  { offset: 0.59, transform: "translateY(-30px) scale(0.94, 1.07) rotate(4deg)", easing: OUT },
  { offset: 0.7, transform: "translateY(-78px) scale(0.98, 1.02) rotate(5deg)", easing: IN },
  { offset: 0.83, transform: "translateY(0) scale(1.18, 0.82) rotate(0deg)", easing: SNAP },
  { offset: 0.9, transform: "translateY(-14px) scale(0.97, 1.03) rotate(0deg)", easing: IN },
  { offset: 1, transform: "translateY(0) scale(1, 1) rotate(0deg)" },
];
/* The floor shadow tracks the hop: small and faint at the top of each arc. */
const SHADOW: Keyframe[] = [
  { offset: 0, transform: "scale(0.7)", opacity: 0.25, easing: IN },
  { offset: 0.16, transform: "scale(1.15)", opacity: 0.55, easing: OUT },
  { offset: 0.22, transform: "scale(0.85)", opacity: 0.4, easing: OUT },
  { offset: 0.38, transform: "scale(0.45)", opacity: 0.15, easing: IN },
  { offset: 0.54, transform: "scale(1.12)", opacity: 0.55, easing: OUT },
  { offset: 0.59, transform: "scale(0.88)", opacity: 0.42, easing: OUT },
  { offset: 0.7, transform: "scale(0.62)", opacity: 0.25, easing: IN },
  { offset: 0.83, transform: "scale(1.08)", opacity: 0.55, easing: IN },
  { offset: 0.9, transform: "scale(0.94)", opacity: 0.48, easing: IN },
  { offset: 1, transform: "scale(1)", opacity: 0.5 },
];
const SPARKS = 10;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function AskOverlay({
  firstName,
  closing,
  onClose,
}: {
  firstName: string;
  closing: boolean;
  onClose: () => void;
}) {
  const [stage, setStage] = useState<"intro" | "ready">("intro");
  const [mood, setMood] = useState<"calm" | "happy">("calm");
  const [look, setLook] = useState<"ahead" | "right">("right");
  const [phase, setPhase] = useState<MorphPhase>("idle");
  // Read once on the client: the server's clock is not the merchant's.
  const [hello] = useState(greeting);

  const rootRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const placeRef = useRef<HTMLDivElement>(null);
  const travelRef = useRef<HTMLDivElement>(null);
  const hopRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const sparkRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const orbRef = useRef<MorphOrbHandle>(null);

  const stageRef = useRef(stage);
  stageRef.current = stage;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const skipRef = useRef<() => void>(() => {});

  /* ── the intro ── */
  useLayoutEffect(() => {
    const slot = slotRef.current, place = placeRef.current;
    if (!slot || !place) return;

    const timers: number[] = [];
    const anims: Animation[] = [];
    let done = false;
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const run = (el: Element | null, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      if (!el) return null;
      const a = el.animate(frames, opts);
      anims.push(a);
      return a;
    };

    const rest = `translate(0px, 0px) scale(${REST_SCALE})`;
    const settle = () => {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
      place.style.transform = rest;
      setLook("ahead");
      setMood("happy");
      setStage("ready");
      later(() => setMood("calm"), 1100);
    };
    skipRef.current = settle;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      settle();
      return () => timers.forEach(clearTimeout);
    }

    // Centre stage, measured from where the mascot will finally rest, so the
    // last move is one straight glide (FLIP) rather than a jump.
    const r = slot.getBoundingClientRect();
    const dx = window.innerWidth / 2 - (r.left + r.width / 2);
    const dy = window.innerHeight * 0.44 - (r.top + r.height / 2);
    const centre = `translate(${dx}px, ${dy}px) scale(1)`;
    place.style.transform = centre;

    const TRAVEL = 1300;
    run(travelRef.current, [
      { transform: `translateX(${-(window.innerWidth / 2 + BIG + 40)}px)` },
      { transform: "translateX(0px)" },
    ], { duration: TRAVEL, easing: "cubic-bezier(0.3, 0.55, 0.4, 1)", fill: "both" });
    run(hopRef.current, HOP, { duration: TRAVEL, fill: "both" });
    run(shadowRef.current, SHADOW, { duration: TRAVEL, fill: "both" });

    // Impact: the smile lands with a pop, a shockwave, sparks and a flash.
    later(() => {
      setLook("ahead");
      setMood("happy");
      run(popRef.current, [
        { transform: "scale(1)" },
        { transform: "scale(1.28)", offset: 0.28 },
        { transform: "scale(0.9)", offset: 0.55 },
        { transform: "scale(1.06)", offset: 0.78 },
        { transform: "scale(1)" },
      ], { duration: 680, easing: "ease-out" });
      run(ringRef.current, [
        { transform: "scale(0.6)", opacity: 0.9 },
        { transform: "scale(2.6)", opacity: 0 },
      ], { duration: 720, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" });
      run(flashRef.current, [
        { opacity: 0 },
        { opacity: 1, offset: 0.25 },
        { opacity: 0 },
      ], { duration: 620, easing: "ease-out", fill: "both" });
      sparkRefs.current.forEach((el, i) => {
        const a = (i / SPARKS) * Math.PI * 2 - Math.PI / 2;
        const d = 96 + (i % 2) * 34;
        run(el, [
          { transform: "translate(-50%, -50%) scale(0) rotate(0deg)", opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d * 0.7}px), calc(-50% + ${Math.sin(a) * d * 0.7}px)) scale(1.1) rotate(90deg)`, opacity: 1, offset: 0.55 },
          { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0) rotate(180deg)`, opacity: 0 },
        ], { duration: 760, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both", delay: i % 2 ? 40 : 0 });
      });
    }, TRAVEL);

    // Glide into place; the page rises in around it.
    later(() => {
      if (done) return;
      const glide = run(place, [{ transform: centre }, { transform: rest }], {
        duration: 720,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      });
      setStage("ready");
      glide?.finished.then(() => { if (!done) settle(); }, () => {});
    }, TRAVEL + 1050);

    return () => {
      done = true;
      timers.forEach(clearTimeout);
      anims.forEach((a) => a.cancel());
    };
  }, []);

  /* ── keys: any key skips the intro; Escape closes once the orb is idle ── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (stageRef.current === "intro") {
        skipRef.current();
        if (e.key === "Escape") e.preventDefault();
        return;
      }
      if (e.key === "Escape" && phaseRef.current === "idle" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* ── the page behind must not scroll while this is up ── */
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    rootRef.current?.focus({ preventScroll: true });
    return () => { html.style.overflow = prev; };
  }, []);

  const onPhaseChange = useCallback((p: MorphPhase) => setPhase(p), []);
  const busy = phase !== "idle";

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Ask Tender"
      tabIndex={-1}
      className="ask-root"
      data-stage={stage}
      data-busy={busy ? "" : undefined}
      data-closing={closing ? "" : undefined}
      onPointerDown={() => { if (stageRef.current === "intro") skipRef.current(); }}
    >
      <div className="ask-wash" aria-hidden="true" />
      <div ref={flashRef} className="ask-flash" aria-hidden="true" />

      <header className="ask-top">
        <span className="ask-brand">
          <TenderMark className="h-[1.125rem] w-[1.125rem] text-ink" />
          Ask Tender
        </span>
        <button type="button" onClick={onClose} className="ask-close" aria-label="Close Ask">
          <CloseIcon className="h-[1.125rem] w-[1.125rem]" />
        </button>
      </header>

      <div className="ask-main">
        <div ref={slotRef} className="ask-slot">
          <div ref={placeRef} className="ask-place" style={{ width: BIG, height: BIG, margin: -BIG / 2 }}>
            <div ref={travelRef} className="ask-travel">
              <div ref={shadowRef} className="ask-shadow" />
              <div ref={hopRef} className="ask-hop">
                <div ref={popRef} className="ask-pop">
                  <Mascot mood={mood} look={look} className="h-full w-full" />
                </div>
              </div>
              <div ref={ringRef} className="ask-ring" />
              {Array.from({ length: SPARKS }).map((_, i) => (
                <span key={i} ref={(el) => { sparkRefs.current[i] = el; }} className="ask-spark" data-ink={i % 3 === 0 ? "" : undefined}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M12 1.5l2.6 7.9 7.9 2.6-7.9 2.6L12 22.5l-2.6-7.9L1.5 12l7.9-2.6z" />
                  </svg>
                </span>
              ))}
            </div>
          </div>
        </div>

        <h2 className="ask-fade ask-hello" style={{ transitionDelay: "60ms" }}>
          {firstName ? `${hello}, ${firstName}` : hello}
          <svg className="ask-hello-spark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7z" />
            <path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
          </svg>
        </h2>
        <p className="ask-fade ask-sub" style={{ transitionDelay: "140ms" }}>
          Ask anything about your money.
        </p>
      </div>

      {stage === "ready" && (
        <>
          <div className="ask-chips" aria-label="Suggested questions" role="group">
            <div className="ask-chips-row">
              {QUESTIONS.map((q, i) => (
                <button
                  key={q.slug}
                  type="button"
                  className="ask-chip"
                  style={{ animationDelay: `${220 + i * 60}ms` }}
                  disabled={busy}
                  onClick={() => orbRef.current?.ask(q.label)}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ask-orb">
            <MorphOrb apiRef={orbRef} onSubmit={askTender} onPhaseChange={onPhaseChange} />
          </div>

          <p className="ask-note">
            Answers come from your live Tender payments. Check anything important on the payment itself.
          </p>
        </>
      )}
    </div>
  );
}
