import { PageHeader, PageShell } from "@/components/dash/shell";

/**
 * A screen that has a route and a place in the nav, but is not built yet.
 *
 * It exists so the shell can be navigated end to end while the screens are
 * built one at a time, and so nothing in the nav dead-ends on a 404. It says
 * plainly that the screen is not ready rather than implying data is loading —
 * an honest unbuilt state, not a fake one.
 *
 * Every use of this is deleted as its screen lands.
 */
export function Placeholder({
  eyebrow,
  title,
  description,
  building,
}: {
  eyebrow: string;
  title: string;
  description: string;
  /** What this screen will do once built. Shown as a short list. */
  building: string[];
}) {
  return (
    <PageShell>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />

      <div className="relative rounded-2xl border border-dashed border-line bg-paper p-6 md:p-8">
        <p className="eyebrow mb-4 text-mute">Being built</p>
        <ul className="flex flex-col gap-2.5">
          {building.map((item) => (
            <li key={item} className="flex gap-3 text-[0.9375rem] text-ink">
              <span
                aria-hidden="true"
                className="mt-[0.5625rem] h-[0.3125rem] w-[0.3125rem] shrink-0 rounded-full bg-sand"
              />
              <span className="leading-relaxed">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </PageShell>
  );
}
