import { comparison } from "@/lib/copy";

const TONES: Record<string, { bar: string; text: string }> = {
  bad: { bar: "bg-line", text: "text-mute" },
  mid: { bar: "bg-mute/25", text: "text-mute" },
  good: { bar: "bg-[#1F5A32]", text: "text-paper" },
};

export default function Comparison() {
  return (
    <section className="section-y">
      <div className="shell grid items-end gap-14 md:grid-cols-[0.85fr_1fr] md:gap-20">
        <div>
          <h2 className="whitespace-pre-line text-balance">
            {comparison.heading}
          </h2>
          <p className="mt-6 max-w-[42ch] text-pretty text-ink/70">
            {comparison.body}
          </p>
        </div>

        <div>
          <div className="flex h-[360px] items-end gap-5 md:gap-8">
            {comparison.bars.map((bar) => {
              const tone = TONES[bar.tone];
              return (
                <div
                  key={bar.label}
                  className="flex h-full flex-1 flex-col justify-end"
                >
                  {/* The token marks sit above each bar, as the bank logos do. */}
                  <span className="mb-4 text-center text-lg tracking-[0.15em] text-mute">
                    {bar.marks}
                  </span>

                  {/* Value lives inside the bar, bottom-left — the Goldsand move. */}
                  <div
                    className={`flex w-full items-end rounded-t-[14px] px-4 pb-3 ${tone.bar}`}
                    style={{ height: `max(${bar.pct}%, 3rem)` }}
                  >
                    <span
                      className={`font-display text-2xl leading-none md:text-[1.75rem] ${tone.text}`}
                    >
                      {bar.value}
                    </span>
                  </div>

                  <span className="mt-3 text-center text-[0.8125rem] leading-tight text-mute">
                    {bar.label}
                  </span>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-[0.8125rem] text-mute">
            {comparison.footnote}
          </p>
        </div>
      </div>
    </section>
  );
}
