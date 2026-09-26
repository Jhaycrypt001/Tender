"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useScroll,
  useMotionValueEvent,
  useReducedMotion,
} from "motion/react";
import { feeScroll } from "@/lib/copy";

const BEATS = feeScroll.beats;

/** The tile + caption for one beat. Shared by the sticky and stacked layouts. */
function Beat({ index }: { index: number }) {
  const beat = BEATS[index];
  return (
    <>
      {/* The tile scales with the viewport rather than sitting at a fixed
          270px, which overflowed the gutters on a 375px screen. The sketches
          carry their own generous margin, so the image fills the tile at 92%
          instead of 70%: nesting two margins left the art floating small. */}
      <div className="flex aspect-square w-[min(270px,68vw)] items-center justify-center rounded-[20px] bg-stone">
        <Image
          src={beat.img}
          alt={beat.alt}
          width={540}
          height={540}
          sizes="(max-width: 640px) 68vw, 270px"
          className="h-[92%] w-[92%] object-contain mix-blend-multiply"
        />
      </div>

      <p className="mt-10 max-w-[22ch] text-balance text-xl font-semibold md:text-2xl">
        {beat.caption}
      </p>

      {beat.sub && (
        <p className="mt-2 max-w-[34ch] text-balance text-ink/55">{beat.sub}</p>
      )}

      {"link" in beat && beat.link && (
        <Link
          href={beat.link.href}
          className="mt-5 inline-block border-b border-sand pb-0.5 text-sand transition-opacity duration-200 hover:opacity-70"
        >
          {beat.link.label}
        </Link>
      )}
    </>
  );
}

export default function FeeScroll() {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const reduced = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  useMotionValueEvent(scrollYProgress, "change", (p) => {
    // Map 0→1 across the beats, clamped so the last beat holds at the bottom.
    const next = Math.min(BEATS.length - 1, Math.floor(p * BEATS.length));
    setIndex((prev) => (prev === next ? prev : next));
  });

  return (
    <section id="product">
      {/* Mobile + reduced motion: plain vertical stack, no pinning. */}
      <div className="section-y lg:hidden motion-reduce:lg:block">
        <div className="shell">
          <h2 className="text-center text-balance">{feeScroll.heading}</h2>
          <div className="mt-14 flex flex-col items-center gap-20">
            {BEATS.map((_, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <Beat index={i} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Desktop: one viewport of scroll per beat, driving a pinned stage.
          The track is BEATS.length viewports tall and the stage fills the last
          one, so the section ends the moment the final beat is done — no
          trailing dead space. */}
      <div
        ref={ref}
        className="hidden lg:block motion-reduce:lg:hidden"
        style={{ height: `${BEATS.length * 70}vh` }}
      >
        <div className="sticky top-0 flex h-screen flex-col items-center justify-center">
          <div className="shell">
            <h2 className="text-center text-balance">{feeScroll.heading}</h2>
          </div>

          <div className="mt-16 flex flex-col items-center text-center">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={index}
                initial={reduced ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? undefined : { opacity: 0, y: -12 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center"
              >
                <Beat index={index} />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Progress pips — which beat you're on. */}
          <div className="mt-14 flex gap-2" aria-hidden="true">
            {BEATS.map((_, i) => (
              <span
                key={i}
                className={`h-1 rounded-full transition-all duration-500 ${
                  i === index ? "w-7 bg-ink" : "w-1.5 bg-line"
                }`}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
