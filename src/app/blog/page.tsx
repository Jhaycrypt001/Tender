import type { Metadata } from "next";
import Link from "next/link";
import { posts, formatDate } from "@/lib/posts";

export const metadata: Metadata = {
  title: "Insights and updates — Tender",
  description:
    "Notes on crypto checkout, settlement and the parts of payments nobody writes about.",
};

export default function BlogIndex() {
  return (
    <article>
      {/* pt is generous because the nav is fixed and this page has no hero. */}
      <header className="shell pb-12 pt-28 md:pb-16 md:pt-36">
        <p className="eyebrow text-sand">Insights and updates</p>
        <h1 className="mt-6 max-w-[18ch] text-balance">
          Notes from building a checkout
        </h1>
        <p className="mt-6 max-w-[52ch] text-pretty text-ink/70">
          What we are learning about crypto payments, settlement and the
          failure paths most processors would rather not talk about.
        </p>
      </header>

      <div className="shell pb-24 md:pb-32">
        <ul className="border-t border-line">
          {posts.map((post) => (
            <li key={post.slug} className="border-b border-line">
              <Link
                href={`/blog/${post.slug}`}
                className="group grid gap-4 py-8 transition-colors duration-300 md:grid-cols-[10rem_1fr] md:gap-10 md:py-10"
              >
                <p className="font-mono text-[0.6875rem] uppercase leading-relaxed tracking-[0.14em] text-mute">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span className="block">{post.category}</span>
                </p>
                <div>
                  <h2 className="font-display text-[clamp(1.375rem,3.2vw,1.875rem)] leading-tight tracking-[-0.02em] text-balance transition-colors duration-200 group-hover:text-sand">
                    {post.title}
                  </h2>
                  <p className="mt-3 max-w-[62ch] text-pretty text-[0.9375rem] leading-relaxed text-ink/70">
                    {post.excerpt}
                  </p>
                  <p className="mt-4 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute">
                    {post.readingTime}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
