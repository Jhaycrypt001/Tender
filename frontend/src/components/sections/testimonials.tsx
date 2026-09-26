import { testimonials } from "@/lib/copy";

type Item = (typeof testimonials)[number];

function Card({ item }: { item: Item }) {
  return (
    <figure className="flex w-[330px] shrink-0 flex-col justify-between rounded-[20px] border border-line bg-paper p-6 md:w-[380px]">
      <blockquote className="text-[0.9375rem] leading-relaxed text-ink/80">
        &ldquo;{item.quote}&rdquo;
      </blockquote>
      <figcaption className="mt-6 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-stone font-display text-sm">
          {item.name.charAt(0)}
        </span>
        <span className="leading-tight">
          <span className="block text-[0.875rem] font-medium">{item.name}</span>
          <span className="block text-[0.8125rem] text-mute">{item.role}</span>
        </span>
      </figcaption>
    </figure>
  );
}

function Row({
  items,
  direction,
}: {
  items: readonly Item[];
  direction: "left" | "right";
}) {
  return (
    <div className="marquee-mask overflow-hidden">
      <div
        className={`flex w-max gap-4 ${
          direction === "left" ? "animate-marquee-left" : "animate-marquee-right"
        }`}
      >
        {/* Duplicated once so the -50% translate loops seamlessly. */}
        {[...items, ...items].map((item, i) => (
          <Card key={i} item={item} />
        ))}
      </div>
    </div>
  );
}

export default function Testimonials() {
  const top = testimonials.slice(0, 3);
  const bottom = testimonials.slice(3);

  return (
    <section className="overflow-hidden py-16 md:py-20">
      <div className="flex flex-col gap-4">
        <Row items={top} direction="left" />
        <Row items={bottom} direction="right" />
      </div>
    </section>
  );
}
