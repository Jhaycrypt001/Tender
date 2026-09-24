import Link from "next/link";
import { blog, posts, formatDate } from "@/lib/posts";

export default function Insights() {
  return (
    <section id="blog" className="section-y section-y-flush-t">
      <div className="shell">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="eyebrow text-sand">{blog.eyebrow}</p>
            <h2 className="mt-5 max-w-[16ch] text-balance">{blog.heading}</h2>
          </div>
          <Link
            href={blog.cta.href}
            className="group inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-ink transition-colors duration-200 hover:text-sand"
          >
            {blog.cta.label}
            <span
              aria-hidden
              className="transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:translate-x-1 motion-reduce:transform-none"
            >
              →
            </span>
          </Link>
        </div>

        {/* Whole card is the link target — a small "read more" is a needlessly
            small tap area on a phone. */}
        <ul className="mt-12 grid gap-px overflow-hidden rounded-[20px] bg-line md:mt-16 md:grid-cols-3">
          {posts.map((post) => (
            <li key={post.slug} className="bg-paper">
              <Link
                href={`/blog/${post.slug}`}
                className="group flex h-full flex-col p-7 transition-colors duration-300 hover:bg-stone md:p-8"
              >
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                  {post.category}
                </p>
                <h3 className="mt-4 font-display text-xl leading-tight tracking-[-0.01em] text-balance md:text-[1.4rem]">
                  {post.title}
                </h3>
                <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed text-ink/70">
                  {post.excerpt}
                </p>
                <p className="mt-auto pt-8 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute">
                  <time dateTime={post.date}>{formatDate(post.date)}</time>
                  <span className="mx-2 text-line">·</span>
                  {post.readingTime}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
