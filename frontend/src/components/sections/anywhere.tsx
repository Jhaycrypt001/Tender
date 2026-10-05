import { anywhere } from "@/lib/copy";
import Button from "../button";
import MediaSlot from "../media-slot";

export default function Anywhere() {
  return (
    <section className="bg-ink text-paper">
      {/* The ochre bloom sits behind the phone. One accent colour
          per dark section and nothing else: sand, never green. */}
      {/* Bottom padding is trimmed because Card follows immediately on the same
          ink ground: a full section-y here plus Card's own panel inset reads as
          a dead gap rather than rhythm. The three dark sections are one block. */}
      <div className="shell section-y section-y-tight-b relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 top-1/4 h-[28rem] w-[28rem] rounded-full bg-sand/20 blur-[120px]"
        />

        <div className="relative grid gap-14 md:grid-cols-[1fr_1fr] md:items-center md:gap-20">
          <div>
            <p className="eyebrow text-sand">{anywhere.eyebrow}</p>
            <h2 className="mt-5 max-w-[16ch] text-balance">
              {anywhere.heading}
            </h2>
            <p className="mt-5 max-w-[46ch] text-pretty font-mono text-[0.875rem] leading-relaxed text-paper/60">
              {anywhere.body}
            </p>

            <ul className="mt-10 divide-y divide-paper/10 border-y border-paper/10">
              {anywhere.points.map((p) => (
                <li key={p.title} className="flex gap-4 py-5">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 flex-none rotate-45 bg-sand"
                  />
                  <div>
                    <h3 className="font-sans text-[0.9375rem] font-semibold tracking-normal text-paper">
                      {p.title}
                    </h3>
                    <p className="mt-1.5 max-w-[48ch] text-pretty text-[0.875rem] leading-relaxed text-paper/55">
                      {p.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-10">
              <Button href={anywhere.cta.href} variant="inverse" size="lg">
                {anywhere.cta.label}
              </Button>
            </div>
          </div>

          {/* The render carries its own near-black ground, which is a slightly
              different black from --ink and so shows as a rectangle if left
              alone. The mask has to start falling off well inside the image
              (not at 60%) for the edge to actually disappear; an ellipse
              matched to the portrait crop keeps the phone itself untouched. */}
          {/* Held a little narrower than the column so the portrait render's
              height stays close to the checklist beside it. */}
          <div className="relative mx-auto w-full max-w-[290px] md:max-w-[330px]">
            <MediaSlot
              src={anywhere.image.src}
              alt={anywhere.image.alt}
              width={1086}
              height={1448}
              sizes="(max-width: 768px) 72vw, 330px"
              className="h-auto w-full [mask-image:radial-gradient(ellipse_78%_70%_at_50%_50%,#000_18%,rgba(0,0,0,0.55)_52%,transparent_82%)]"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
