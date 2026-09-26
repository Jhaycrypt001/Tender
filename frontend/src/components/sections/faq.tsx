import Link from "next/link";
import { faq } from "@/lib/copy";

export default function Faq() {
  return (
    <section id="faq" className="section-y">
      <div className="shell">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="text-balance">{faq.heading}</h2>
          <Link
            href={faq.more.href}
            className="rounded-full border border-line px-5 py-2.5 text-[0.9375rem] transition-colors duration-300 hover:border-ink/40 hover:bg-stone"
          >
            {faq.more.label}
          </Link>
        </div>

        <div className="mt-12 border-t border-line">
          {faq.items.map((item) => (
            <details
              key={item.q}
              name="faq"
              className="group border-b border-line"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-lg font-medium [&::-webkit-details-marker]:hidden">
                {item.q}
                <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line transition-colors duration-300 group-open:border-ink/30">
                  <span className="absolute h-px w-3 bg-ink" />
                  <span className="absolute h-3 w-px bg-ink transition-transform duration-300 group-open:scale-y-0" />
                </span>
              </summary>
              <p className="max-w-[68ch] pb-7 pr-10 text-pretty text-ink/70">
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
