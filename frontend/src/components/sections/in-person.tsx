import { inPerson } from "@/lib/copy";
import { QRCode } from "@/components/pay/qr";
import Button from "../button";

/**
 * "Scan or tap to pay at the counter" — introduces the counter screen and NFC
 * stickers.
 *
 * The till on the right is drawn in code, not a render, and its QR is real:
 * it encodes the live site, so a visitor who scans it out of curiosity lands
 * somewhere true rather than on a decorative pattern that goes nowhere.
 */
const SITE = process.env.APP_URL || "https://tender-pay.vercel.app";

export default function InPerson() {
  return (
    <section id="in-person" className="section-y">
      <div className="shell grid items-center gap-12 md:grid-cols-[1.05fr_1fr] md:gap-16">
        <div>
          <p className="eyebrow text-sand">{inPerson.eyebrow}</p>
          <h2 className="mt-5 max-w-[16ch] text-balance">{inPerson.heading}</h2>
          <p className="mt-5 max-w-[46ch] text-pretty text-ink/70">{inPerson.body}</p>

          <ul className="mt-10 space-y-6">
            {inPerson.points.map((p) => (
              <li key={p.title} className="flex gap-4">
                <span aria-hidden className="mt-[0.7rem] h-px w-4 flex-none bg-sand" />
                <div>
                  <h3 className="font-display text-lg leading-tight tracking-[-0.01em]">
                    {p.title}
                  </h3>
                  <p className="mt-1.5 max-w-[44ch] text-pretty text-[0.9375rem] leading-relaxed text-ink/70">
                    {p.body}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-4">
            <Button href={inPerson.cta.href}>{inPerson.cta.label}</Button>
            <p className="max-w-[34ch] text-[0.8125rem] leading-relaxed text-mute">
              {inPerson.note}
            </p>
          </div>
        </div>

        {/* The till. Stone ground, one white screen, contactless rings. */}
        <div className="crosshairs relative flex justify-center rounded-[20px] bg-stone px-6 py-12 md:py-16">
          <div className="relative w-full max-w-[17.5rem] rounded-[2rem] border border-line bg-paper px-6 pb-7 pt-8 text-center shadow-[0_30px_60px_-30px_rgba(18,17,17,0.35)]">
            <p className="font-mono text-[0.625rem] uppercase tracking-[0.16em] text-mute">
              {inPerson.example.label}
            </p>
            <p className="mt-3 font-display text-[2.5rem] leading-none tracking-[-0.03em]">
              ${inPerson.example.amount}
            </p>
            <div className="mx-auto mt-6 w-fit rounded-2xl border border-line p-2.5">
              <QRCode value={SITE} size={168} />
            </div>
            <div className="mt-6 flex items-center justify-center gap-3 text-[0.8125rem]">
              <Rings />
              Scan, or tap here
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Contactless arcs that pulse outward. Still under reduced motion. */
function Rings() {
  return (
    <span aria-hidden className="relative flex h-6 w-6 items-center justify-center text-sand">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
        <path d="M7 9.5a4 4 0 0 1 0 5" />
        <path d="M10.5 7a8 8 0 0 1 0 10" className="animate-pulse motion-reduce:animate-none" />
        <path d="M14 4.5a12 12 0 0 1 0 15" className="animate-pulse [animation-delay:300ms] motion-reduce:animate-none" />
      </svg>
    </span>
  );
}
