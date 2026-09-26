import { card } from "@/lib/copy";
import Button from "../button";
import MediaSlot from "../media-slot";

export default function Card() {
  return (
    <section className="bg-ink text-paper">
      {/* Both padding sides are trimmed: Anywhere sits above and SettleLive
          below on the same ground, so the panels need a gap between them, not
          a full section rhythm on each side of each one. */}
      <div className="shell section-y section-y-flush-t section-y-tight-b">
        {/* Rounded ink panel rather than a full-bleed band, so this reads as a
            distinct product announcement inside the dark run. */}
        <div className="crosshairs relative overflow-hidden rounded-[22px] border border-paper/10 px-5 py-11 md:px-11 md:py-14">
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 h-[24rem] w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-sand/25 blur-[130px]"
          />

          <div className="relative grid gap-12 md:grid-cols-[1fr_1fr] md:items-center md:gap-16">
            <div>
              <p className="eyebrow text-sand">{card.eyebrow}</p>
              <h2 className="mt-5 max-w-[15ch] text-balance">{card.heading}</h2>
              <p className="mt-5 max-w-[46ch] text-pretty font-mono text-[0.875rem] leading-relaxed text-paper/60">
                {card.body}
              </p>

              <ul className="mt-9 space-y-3">
                {card.points.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-3 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-paper/70"
                  >
                    <span aria-hidden className="h-px w-4 flex-none bg-sand" />
                    {p}
                  </li>
                ))}
              </ul>

              <div className="mt-10">
                <Button href={card.cta.href} variant="inverse" size="lg">
                  {card.cta.label}
                </Button>
              </div>
            </div>

            {/* The render already carries its own three-quarter angle and a
                black ground, so no CSS rotation — that would read as a double
                tilt. The ellipse is matched to the landscape crop and starts
                its falloff early, because the render's black is lighter than
                the panel and a late falloff leaves a visible plate. No scale:
                enlarging pushes the masked edge back towards the frame. */}
            {/* Negative block margin absorbs the render's own empty border so
                the card sits optically level with the copy beside it. */}
            <div className="mx-auto w-full max-w-[450px] md:-my-8">
              <MediaSlot
                src={card.image.src}
                alt={card.image.alt}
                width={1448}
                height={1086}
                sizes="(max-width: 768px) 88vw, 450px"
                className="h-auto w-full transition-transform duration-700 ease-[var(--ease-out-expo)] hover:scale-[1.04] motion-reduce:transform-none motion-reduce:transition-none [mask-image:radial-gradient(ellipse_72%_72%_at_50%_50%,#000_14%,rgba(0,0,0,0.5)_48%,transparent_78%)]"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
