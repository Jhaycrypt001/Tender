import { showcase } from "@/lib/copy";

export default function Showcase() {
  return (
    <section className="section-y">
      <div className="shell">
        <h2 className="max-w-[16ch] text-balance">{showcase.heading}</h2>

        <div className="mt-14 grid gap-14 md:mt-20 md:grid-cols-[1fr_1fr] md:items-center md:gap-20">
          {/* Left rail — three claims, hairline-separated. */}
          <ol className="divide-y divide-line border-t border-line">
            {showcase.items.map((item, i) => (
              <li key={item.title} className="flex gap-6 py-7 md:py-8">
                <span className="shrink-0 pt-1 font-sans text-xs tabular-nums tracking-[0.12em] text-sand">
                  0{i + 1}
                </span>
                <div>
                  <h3 className="font-display text-xl leading-tight tracking-[-0.01em] md:text-2xl">
                    {item.title}
                  </h3>
                  <p className="mt-2.5 max-w-[46ch] text-pretty text-[0.9375rem] leading-relaxed text-ink/70">
                    {item.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {/* Right panel — the looping wallet clip. It is decoration, not
              content, so it carries no controls and no audio track. */}
          <figure className="m-0">
            <div className="dot-grid overflow-hidden rounded-[24px] bg-stone">
              <video
                className="h-auto w-full motion-reduce:hidden"
                src={showcase.video}
                poster={showcase.poster}
                width={864}
                height={1080}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                aria-label="A merchant wallet balance counting up to $4,820.00 as recent payments appear"
              />
              {/* Reduced motion gets the still dashboard instead of a loop. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="hidden h-auto w-full motion-reduce:block"
                src={showcase.poster}
                alt="The Tender merchant dashboard showing a $4,820.00 balance and recent payments from Bitcoin, Solana and USDT on Tron"
                width={864}
                height={1080}
              />
            </div>
            <figcaption className="mt-4 text-center text-[0.8125rem] text-mute">
              {showcase.caption}
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
