import { settleLive } from "@/lib/copy";
import Button from "../button";
import Image from "next/image";

export default function SettleLive() {
  return (
    <section className="bg-ink text-paper">
      <div className="shell section-y section-y-flush-t">
        {/* Panel left on the section's own ink rather than lifted with
            bg-paper/[0.04]. The render's ground is true black, so a lighter
            panel behind it made the image read as a plate sitting on top —
            the card section blends because its panel is the same black. */}
        <div className="crosshairs relative overflow-hidden rounded-[22px] border border-paper/10 px-5 py-10 md:px-11 md:py-14">
          {/* Kept deliberately faint. The render carries its own ochre bloom,
              so a strong panel glow on top of it washed the settlement card
              out — the card section works because its glow stays well under
              the render rather than competing with it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute -left-24 bottom-0 h-[20rem] w-[20rem] rounded-full bg-sand/[0.07] blur-[140px]"
          />

          <div className="relative grid gap-12 md:grid-cols-[1fr_1.05fr] md:items-center md:gap-16">
            <div>
              {/* Two static labels, the first
                  active. Not tabs: there is nothing to switch between. */}
              <div className="flex items-center gap-2">
                {settleLive.tabs.map((t, i) => (
                  <span
                    key={t}
                    className={`rounded-full px-3.5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${
                      i === 0
                        ? "bg-sand text-ink"
                        : "border border-paper/15 text-paper/50"
                    }`}
                  >
                    {t}
                  </span>
                ))}
              </div>

              <h2 className="mt-7 max-w-[17ch] text-balance">
                {settleLive.heading}
              </h2>
              <p className="mt-5 max-w-[46ch] text-pretty font-mono text-[0.875rem] leading-relaxed text-paper/60">
                {settleLive.body}
              </p>

              <div className="mt-10 flex flex-wrap items-end gap-8">
                <div>
                  <p className="font-display text-[clamp(2rem,5vw,2.875rem)] leading-none tracking-[-0.03em] text-sand tabular-nums">
                    {settleLive.stat.value}
                  </p>
                  <p className="mt-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper/50">
                    {settleLive.stat.label}
                  </p>
                </div>
                <Button href={settleLive.cta.href} variant="inverse" size="lg">
                  {settleLive.cta.label}
                </Button>
              </div>
            </div>

            {/* Masked rather than rounded — a radius would cut the render's
                ochre bloom off on a hard curve. The falloff is held late and
                opaque well past the card's own edge, so the settlement card
                itself stays crisp and only the flat black corners dissolve.
                An earlier falloff (opaque to 30%, gone by 76%) was eating the
                card's border and made the whole slot read as a soft blur. */}
            <div className="mx-auto w-full max-w-[420px]">
              <Image
                src={settleLive.image.src}
                alt={settleLive.image.alt}
                width={1254}
                height={1254}
                sizes="(max-width: 768px) 88vw, 420px"
                className="h-auto w-full [mask-image:radial-gradient(ellipse_62%_62%_at_50%_50%,#000_55%,rgba(0,0,0,0.45)_74%,transparent_92%)]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
