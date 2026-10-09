import Link from "next/link";
import Image from "next/image";
import { footer } from "@/lib/copy";
import Button from "./button";

const WORDMARK = "TENDER".split("");

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-line pt-20 md:pt-28">
      <div className="shell">
        {/* Top band — the last thing goldsand says before the link grid. */}
        <div className="grid gap-10 border-b border-line pb-14 md:grid-cols-[1.1fr_1fr] md:items-end md:gap-16 md:pb-20">
          <div>
            <p className="font-display text-[clamp(1.5rem,3.2vw,2.125rem)] leading-[1.1] tracking-[-0.02em] text-balance md:max-w-[14ch]">
              {footer.tagline}
            </p>
            <p className="mt-5 max-w-[46ch] text-pretty text-[0.9375rem] leading-relaxed text-ink/70">
              {footer.blurb}
            </p>
          </div>

          <div className="flex flex-col items-start gap-6 md:items-end">
            <Button href={footer.cta.href}>{footer.cta.label}</Button>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {footer.social.map((s) => (
                <li key={s.label}>
                  <Link
                    href={s.href}
                    className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute transition-colors duration-200 hover:text-sand"
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Link grid — 2-up on phones, 3-up from sm. */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 sm:grid-cols-3 md:py-20">
          {footer.columns.map((col) => (
            <div key={col.title}>
              <h2 className="mb-5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                {col.title}
              </h2>
              <ul className="space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-[0.9375rem] text-ink/70 transition-colors duration-200 hover:text-sand"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* The showpiece — five domes fused into one bell. The render's
            backdrop is near-white rather than pure white, so it reads as a
            grey plate on the page; mix-blend-multiply drops it out. */}
        <div className="flex justify-center">
          <Image
            src="/img/bell.png"
            alt="A brass counter bell with five fused domes"
            width={1240}
            height={1240}
            sizes="(max-width: 768px) 240px, 360px"
            className="h-auto w-[240px] mix-blend-multiply md:w-[360px]"
          />
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-line pt-8 text-xs text-mute sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-[60ch]">{footer.note}</p>
          <p className="shrink-0">© {new Date().getFullYear()} Tender</p>
        </div>
      </div>

      {/* Giant wordmark, clipped by the viewport bottom. Hover lifts each
          letter on a stagger. aria-hidden: it is the logo repeated, not text
          a screen reader needs to hear a second time. */}
      <div
        aria-hidden
        className="group mt-10 flex select-none justify-center"
        style={{ marginBottom: "clamp(-3.25rem, -5vw, -2rem)" }}
      >
        <div className="flex leading-[0.78]">
          {WORDMARK.map((ch, i) => (
            <span
              key={i}
              className="font-display transition-transform duration-500 ease-[var(--ease-out-expo)] group-hover:-translate-y-1.5 motion-reduce:transform-none motion-reduce:transition-none"
              style={{
                fontSize: "clamp(3.5rem, 17vw, 12rem)",
                letterSpacing: "-0.04em",
                transitionDelay: `${i * 45}ms`,
              }}
            >
              {ch}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
