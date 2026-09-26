import { capabilities } from "@/lib/copy";

export default function Capabilities() {
  return (
    <section className="bg-stone">
      <div className="shell section-y">
        <div className="max-w-[54ch]">
          <p className="eyebrow text-sand">{capabilities.eyebrow}</p>
          <h2 className="mt-5 text-balance">{capabilities.heading}</h2>
          <p className="mt-5 max-w-[46ch] text-pretty text-ink/70">
            {capabilities.body}
          </p>
        </div>

        <div className="mt-12 grid gap-5 md:mt-16 md:grid-cols-3">
          {capabilities.cards.map((c) => (
            <article
              key={c.title}
              className="flex flex-col rounded-[20px] bg-paper p-7 md:p-8"
            >
              <h3 className="font-display text-xl leading-tight tracking-[-0.01em] md:text-2xl">
                {c.title}
              </h3>
              <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed text-ink/70">
                {c.body}
              </p>
              {/* mt-auto pins the list to the card floor so the three cards
                  agree on a baseline regardless of body length. */}
              <ul className="mt-auto space-y-2.5 pt-8">
                {c.points.map((p) => (
                  <li
                    key={p}
                    className="flex items-center gap-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute"
                  >
                    <span
                      aria-hidden
                      className="h-px w-3.5 flex-none bg-sand"
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
