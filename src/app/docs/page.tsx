import type { Metadata } from "next";
import Link from "next/link";
import { docs } from "@/lib/docs";
import Button from "@/components/button";

export const metadata: Metadata = {
  title: "Documentation — Tender",
  description:
    "Create an invoice, show the checkout, listen for the webhook. The Tender API in three calls.",
};

/** A code block. Dark on a paper page, the way the rest of the site treats
 *  code — the ink sections are where Tender goes dark, and a snippet is the
 *  same idea at a smaller scale. */
function Code({ children }: { children: string }) {
  return (
    <pre className="mt-5 overflow-x-auto rounded-[14px] bg-ink px-5 py-5 font-mono text-[0.8125rem] leading-relaxed text-paper/85 md:px-6">
      <code>{children}</code>
    </pre>
  );
}

function SectionHeading({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="scroll-mt-28 text-[clamp(1.5rem,3vw,2rem)]">
      {children}
    </h2>
  );
}

export default function DocsPage() {
  return (
    <article>
      {/* Generous top padding: the nav is fixed and this page has no hero. */}
      <header className="shell pb-10 pt-28 md:pb-14 md:pt-36">
        <p className="eyebrow text-sand">{docs.eyebrow}</p>
        <h1 className="mt-6 max-w-[16ch] text-balance">{docs.heading}</h1>
        <p className="mt-6 max-w-[56ch] text-pretty text-ink/70">
          {docs.intro}
        </p>
      </header>

      <div className="shell pb-24 md:pb-32">
        <div className="grid gap-12 md:grid-cols-[13rem_1fr] md:gap-16">
          {/* On desktop the contents rail sticks; on mobile it sits inline
              above the body as an ordinary list. */}
          <nav
            aria-label="On this page"
            className="h-max md:sticky md:top-28"
          >
            <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
              On this page
            </p>
            <ul className="mt-4 space-y-2.5 border-l border-line pl-4">
              {[
                ["quickstart", docs.quickstart.title],
                ["api-reference", docs.endpoints.title],
                ["invoice-states", docs.states.title],
                ["webhooks", docs.webhooks.title],
                ["faq", docs.faq.title],
              ].map(([id, label]) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="text-[0.9375rem] text-mute transition-colors duration-200 hover:text-ink"
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            {/* Quickstart */}
            <section>
              <SectionHeading id="quickstart">
                {docs.quickstart.title}
              </SectionHeading>
              <p className="mt-4 max-w-[62ch] text-pretty text-ink/70">
                {docs.quickstart.body}
              </p>

              <p className="mt-8 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                Request
              </p>
              <Code>{docs.quickstart.request}</Code>

              <p className="mt-8 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                Response
              </p>
              <Code>{docs.quickstart.response}</Code>

              <p className="mt-5 border-l-2 border-sand pl-4 text-[0.9375rem] text-pretty text-ink/70">
                {docs.quickstart.note}
              </p>
            </section>

            {/* API reference */}
            <section className="mt-16">
              <SectionHeading id="api-reference">
                {docs.endpoints.title}
              </SectionHeading>
              <p className="mt-4 max-w-[62ch] text-pretty text-ink/70">
                {docs.endpoints.body}
              </p>

              {docs.endpoints.groups.map((group) => (
                <div key={group.label} className="mt-10">
                  <h3>{group.label}</h3>
                  <p className="mt-2 font-mono text-[0.75rem] text-mute">
                    {group.auth}
                  </p>

                  <ul className="mt-5 border-t border-line">
                    {group.rows.map((row) => (
                      <li
                        key={row.method + row.path}
                        className="border-b border-line py-4"
                      >
                        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-mono text-[0.75rem] font-medium tracking-[0.06em] text-sand">
                            {row.method}
                          </span>
                          <span className="font-mono text-[0.8125rem] break-all text-ink">
                            {row.path}
                          </span>
                        </p>
                        <p className="mt-1.5 text-[0.9375rem] text-pretty text-ink/70">
                          {row.desc}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>

            {/* Invoice states */}
            <section className="mt-16">
              <SectionHeading id="invoice-states">
                {docs.states.title}
              </SectionHeading>
              <p className="mt-4 max-w-[62ch] text-pretty text-ink/70">
                {docs.states.body}
              </p>

              <ul className="mt-8 border-t border-line">
                {docs.states.rows.map((row) => (
                  <li key={row.name} className="border-b border-line py-4">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono text-[0.8125rem] font-medium text-ink">
                        {row.name}
                      </span>
                      {row.terminal && (
                        <span className="rounded-full bg-stone px-2.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-mute">
                          Terminal
                        </span>
                      )}
                    </p>
                    <p className="mt-1.5 max-w-[62ch] text-[0.9375rem] text-pretty text-ink/70">
                      {row.desc}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="mt-8 rounded-[16px] bg-stone px-6 py-6">
                <h3 className="text-[1.125rem]">{docs.states.callout.title}</h3>
                <p className="mt-3 max-w-[62ch] text-[0.9375rem] text-pretty text-ink/70">
                  {docs.states.callout.body}
                </p>
              </div>
            </section>

            {/* Webhooks */}
            <section className="mt-16">
              <SectionHeading id="webhooks">
                {docs.webhooks.title}
              </SectionHeading>
              <p className="mt-4 max-w-[62ch] text-pretty text-ink/70">
                {docs.webhooks.body}
              </p>

              <ul className="mt-6 flex flex-wrap gap-2">
                {docs.webhooks.events.map((event) => (
                  <li
                    key={event}
                    className="rounded-full border border-line px-3 py-1 font-mono text-[0.75rem] text-ink/70"
                  >
                    {event}
                  </li>
                ))}
              </ul>

              <p className="mt-8 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                Payload
              </p>
              <Code>{docs.webhooks.payload}</Code>

              <p className="mt-8 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                Verifying the signature
              </p>
              <Code>{docs.webhooks.verify}</Code>

              <p className="mt-5 border-l-2 border-sand pl-4 text-[0.9375rem] text-pretty text-ink/70">
                {docs.webhooks.note}
              </p>
            </section>

            {/* FAQ */}
            <section className="mt-16">
              <SectionHeading id="faq">{docs.faq.title}</SectionHeading>
              <dl className="mt-8 border-t border-line">
                {docs.faq.items.map((item) => (
                  <div key={item.q} className="border-b border-line py-5">
                    <dt className="font-medium">{item.q}</dt>
                    <dd className="mt-2 max-w-[62ch] text-[0.9375rem] text-pretty text-ink/70">
                      {item.a}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>

            {/* Close */}
            <section className="mt-16 rounded-[20px] bg-ink px-6 py-10 text-paper md:px-10 md:py-12">
              <h2 className="text-[clamp(1.5rem,3vw,2rem)]">
                {docs.cta.heading}
              </h2>
              <p className="mt-4 max-w-[48ch] text-pretty text-paper/70">
                {docs.cta.body}
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button href={docs.cta.primary.href} variant="inverse" size="lg">
                  {docs.cta.primary.label}
                </Button>
                <Link
                  href={docs.cta.secondary.href}
                  className="inline-flex items-center justify-center rounded-full border border-paper/20 px-6 py-3 text-[0.9375rem] font-medium text-paper transition-colors duration-300 hover:bg-paper/10"
                >
                  {docs.cta.secondary.label}
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </article>
  );
}
