import Image from "next/image";
import { cta } from "@/lib/copy";
import Button from "../button";

export default function Cta() {
  return (
    <section id="get-started" className="section-y section-y-flush-t">
      <div className="shell">
        <div className="dot-grid overflow-hidden rounded-[28px] bg-stone px-6 pt-16 md:px-14 md:pt-20">
          <div className="grid items-end gap-10 md:grid-cols-[1fr_1fr] md:gap-8">
            {/* Text column sits on the baseline of the phone, not centred —
                the image is what gives this block its height. */}
            <div className="pb-4 text-center md:pb-28 md:text-left">
              <h2 className="max-w-[18ch] text-balance md:mx-0">
                {cta.heading}
              </h2>
              <p className="mt-5 max-w-[44ch] text-pretty text-ink/70 md:mx-0">
                {cta.body}
              </p>
              <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row sm:justify-center md:justify-start">
                <Button href={cta.primary.href}>{cta.primary.label}</Button>
                <Button href={cta.secondary.href} variant="inverse">
                  {cta.secondary.label}
                </Button>
              </div>
            </div>

            {/* The render is cut off by the tile's bottom edge, so it reads as
                rising out of the block rather than floating inside it. */}
            <Image
              src="/img/dashboard-hand.png"
              alt="A hand holding a phone showing the Tender merchant dashboard with a $4,820.00 balance and payments received from Bitcoin, Solana and USDT on Tron"
              width={1456}
              height={1086}
              sizes="(max-width: 768px) 100vw, 620px"
              className="mx-auto -mb-px h-auto w-full max-w-[560px] scale-[1.18] origin-bottom mix-blend-multiply"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
