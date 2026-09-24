import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { posts, getPost, formatDate } from "@/lib/posts";

type Props = { params: Promise<{ slug: string }> };

/** Static params means all three posts are prerendered at build time. */
export function generateStaticParams() {
  return posts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = getPost((await params).slug);
  if (!post) return {};
  return {
    title: `${post.title} — Tender`,
    description: post.excerpt,
    openGraph: {
      title: post.title,
      description: post.excerpt,
      type: "article",
      publishedTime: post.date,
    },
  };
}

export default async function PostPage({ params }: Props) {
  const post = getPost((await params).slug);
  if (!post) notFound();

  const others = posts.filter((p) => p.slug !== post.slug);

  return (
    <article className="shell pb-20 pt-28 md:pb-24 md:pt-36">
      <Link
        href="/blog"
        className="group inline-flex items-center gap-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute transition-colors duration-200 hover:text-sand"
      >
        <span
          aria-hidden
          className="transition-transform duration-300 ease-[var(--ease-out-expo)] group-hover:-translate-x-1 motion-reduce:transform-none"
        >
          ←
        </span>
        All posts
      </Link>

      {/* Measure is capped at ~68ch: the whole point of a post page. */}
      <header className="mt-10 max-w-[44rem]">
        <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
          {post.category}
          <span className="mx-2 text-line">·</span>
          <time dateTime={post.date}>{formatDate(post.date)}</time>
          <span className="mx-2 text-line">·</span>
          {post.readingTime}
        </p>
        <h1 className="mt-6 text-balance text-[clamp(2rem,1rem+4.4vw,3.75rem)] leading-[1.06]">
          {post.title}
        </h1>
        <p className="mt-6 text-pretty text-lg leading-relaxed text-ink/70">
          {post.excerpt}
        </p>
      </header>

      <div className="mt-12 max-w-[44rem] border-t border-line pt-12">
        {post.body.map((para, i) => (
          <p
            key={i}
            className="mb-6 text-pretty text-[1.0625rem] leading-[1.75] text-ink/80 last:mb-0"
          >
            {para}
          </p>
        ))}
      </div>

      <aside className="mt-20 border-t border-line pt-10">
        <h2 className="eyebrow text-mute">Keep reading</h2>
        <ul className="mt-8 grid gap-px overflow-hidden rounded-[20px] bg-line md:grid-cols-2">
          {others.map((p) => (
            <li key={p.slug} className="bg-paper">
              <Link
                href={`/blog/${p.slug}`}
                className="flex h-full flex-col p-7 transition-colors duration-300 hover:bg-stone"
              >
                <p className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute">
                  {p.category}
                </p>
                <h3 className="mt-3 font-display text-xl leading-tight tracking-[-0.01em] text-balance">
                  {p.title}
                </h3>
                <p className="mt-auto pt-6 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-mute">
                  {p.readingTime}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </aside>
    </article>
  );
}
