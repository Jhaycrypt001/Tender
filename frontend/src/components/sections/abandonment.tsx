import { abandonment } from "@/lib/copy";

export default function Abandonment() {
  return (
    <section className="section-y">
      <div className="shell">
        <h2 className="max-w-[20ch] text-balance">{abandonment.heading}</h2>
        <p className="mt-6 max-w-[52ch] text-pretty text-ink/70">
          {abandonment.body}
        </p>

        <div className="mt-12 rounded-[20px] border border-line bg-stone p-6 md:p-10">
          <div className="flex flex-wrap items-center justify-between gap-4 text-[0.8125rem] text-mute">
            <span>{abandonment.chartLabels.left}</span>
            <span>{abandonment.chartLabels.right}</span>
          </div>

          <div className="relative mt-8">
            <svg
              viewBox="0 0 800 280"
              className="h-[220px] w-full md:h-[280px]"
              role="img"
              aria-label={`Projected annual settled volume: ${abandonment.with.value} with Tender versus ${abandonment.without.value} without.`}
            >
              <defs>
                <linearGradient id="growth" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1F7A3D" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#1F7A3D" stopOpacity="0" />
                </linearGradient>
              </defs>

              {[0, 70, 140, 210, 280].map((y) => (
                <line
                  key={y}
                  x1="0"
                  y1={y}
                  x2="800"
                  y2={y}
                  stroke="#E6E4E0"
                  strokeWidth="1"
                />
              ))}

              {/* With Tender — compounding upward. */}
              <path
                d="M0 265 C 220 258, 400 210, 560 128 S 720 40, 800 18 L 800 280 L 0 280 Z"
                fill="url(#growth)"
              />
              <path
                d="M0 265 C 220 258, 400 210, 560 128 S 720 40, 800 18"
                fill="none"
                stroke="#1F7A3D"
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* Without — nearly flat. */}
              <path
                d="M0 265 C 240 262, 480 254, 800 238"
                fill="none"
                stroke="#8A8783"
                strokeWidth="2"
                strokeDasharray="5 6"
                strokeLinecap="round"
              />
            </svg>

            <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
              <div>
                <span className="flex items-center gap-2 text-[0.8125rem] text-mute">
                  <span className="h-2 w-2 rounded-full bg-[#1F7A3D]" />
                  {abandonment.with.label}
                </span>
                <span className="mt-1 block font-display text-3xl text-[#1F7A3D]">
                  {abandonment.with.value}
                </span>
              </div>
              <div>
                <span className="flex items-center gap-2 text-[0.8125rem] text-mute">
                  <span className="h-2 w-2 rounded-full bg-mute" />
                  {abandonment.without.label}
                </span>
                <span className="mt-1 block font-display text-3xl text-ink/60">
                  {abandonment.without.value}
                </span>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-5 max-w-[68ch] text-xs leading-relaxed text-mute">
          {abandonment.disclaimer}
        </p>
      </div>
    </section>
  );
}
