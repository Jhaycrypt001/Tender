import Image from "next/image";
import { hero } from "@/lib/copy";
import Button from "../button";
import { KeyIcon, DocsIcon } from "../icons";

export default function Hero() {
  return (
    <section className="relative pt-[94px] pb-14 md:pt-[118px] md:pb-20">
      <div className="shell text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-1.5 text-[0.8125rem] text-mute">
          <span className="h-1.5 w-1.5 rounded-full bg-sand" />
          {hero.eyebrow}
        </span>

        <h1 className="mx-auto mt-7 max-w-[22ch] text-balance">
          {hero.title.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        <p className="mx-auto mt-7 max-w-[56ch] text-pretty text-ink/70">
          {hero.sub}
        </p>

        {/* Both pills solid dark, icon-first — the goldsand.fi store-button pair. */}
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            href={hero.primary.href}
            size="lg"
            icon={<KeyIcon className="h-[1.1em] w-[1.1em]" />}
          >
            {hero.primary.label}
          </Button>
          <Button
            href={hero.secondary.href}
            size="lg"
            icon={<DocsIcon className="h-[1.1em] w-[1.1em]" />}
          >
            {hero.secondary.label}
          </Button>
        </div>

        <p className="mt-6 text-[0.9375rem] text-mute">{hero.note}</p>
      </div>

      {/* Three interlocking phones: got-paid · review · settled.
          The collage bleeds rather than sitting in a card, so there is no
          radius, no tile and no shell padding here — the render carries its
          own backdrop and simply runs to the viewport edges.
          The gradient below feathers its bottom into the page instead of
          ending on a hard horizontal seam. */}
      <div className="relative mt-12 md:mt-14">
        <Image
          src="/img/hero-phones.png"
          alt="Three phone screens showing a payment received confirmation, a checkout review paying 0.00046 BTC to tender.merchant, and a settled $49.00 payment"
          width={1456}
          height={1086}
          priority
          sizes="(max-width: 768px) 100vw, 1040px"
          /* The render's ground is #F0EFEB, not the page's white, so its edges
             would otherwise draw a grey rectangle. mix-blend-multiply is no
             help here (it only disappears on a matching --stone tile, as in
             the CTA), so the edges are feathered instead: the sides and top
             fade to nothing and the gradient below carries the bottom. */
          className="mx-auto h-auto w-full max-w-[1040px] [mask-image:linear-gradient(to_right,transparent,#000_7%,#000_93%,transparent),linear-gradient(to_bottom,transparent,#000_9%)] [mask-composite:intersect] [-webkit-mask-composite:source-in]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-b from-transparent to-paper md:h-28"
        />
      </div>
    </section>
  );
}
