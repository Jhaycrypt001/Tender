import { stats } from "@/lib/copy";

export default function Stats() {
  return (
    <section className="section-y section-y-flush-t">
      <div className="shell">
        {/* The crosshairs sit on the corners of the block itself,
            rather than a border being drawn around it. */}
        <div className="crosshairs relative border-y border-line py-14 md:py-20">
          <div className="grid gap-10 md:grid-cols-[1fr_1fr] md:items-end md:gap-16">
            <div>
              <p className="eyebrow text-sand">{stats.eyebrow}</p>
              <h2 className="mt-5 whitespace-pre-line text-balance">
                {stats.heading}
              </h2>
            </div>
            <p className="max-w-[42ch] text-pretty text-ink/70 md:pb-2">
              {stats.body}
            </p>
          </div>

          {/* 2-up on phones so the figures stay large; 4-up from md. */}
          <dl className="mt-12 grid grid-cols-2 gap-x-6 gap-y-10 md:mt-20 md:grid-cols-4">
            {stats.items.map((item) => (
              <div key={item.label} className="border-t border-line pt-5">
                <dd className="font-display text-[clamp(1.875rem,5vw,2.75rem)] leading-none tracking-[-0.03em] tabular-nums">
                  {item.value}
                </dd>
                <dt className="mt-3 font-mono text-[0.6875rem] uppercase leading-snug tracking-[0.14em] text-mute">
                  {item.label}
                </dt>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
