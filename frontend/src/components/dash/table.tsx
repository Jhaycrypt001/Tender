import Link from "next/link";

/**
 * The list surface.
 *
 * ⚠️ On mobile this is NOT a table. A real `<table>` at 375px either overflows
 * the page or shrinks its columns into unreadable slivers, and horizontal
 * scroll inside a vertically-scrolling list is a well-known way to lose people
 * on a phone. So each row renders twice: as `<tr>` from `md:` up, and as a
 * stacked card below it. Same data, same component, two layouts — which is why
 * a row is declared as CELLS rather than as JSX.
 *
 * The cost is that a caller describes a row as data instead of markup. That is
 * deliberate: it is the only way the two layouts cannot drift apart.
 */

export type Column = {
  key: string;
  label: string;
  /** Right-align numeric columns so figures line up down the page. */
  align?: "left" | "right";
  /** Hide on the narrow table view, where space is tight. Still shown in the
   *  stacked mobile card, which has room for it. */
  secondary?: boolean;
};

export type Row = {
  /** Stable key, and the row's identity for the optional link. */
  id: string;
  /** Cells keyed by `Column.key`. A missing key renders an em dash. */
  cells: Record<string, React.ReactNode>;
  /** Makes the whole row navigate. */
  href?: string;
};

function Cell({ value }: { value: React.ReactNode }) {
  // Distinguish "no value" from "the value is zero": only null/undefined get
  // the dash. A `0` or an empty string is real data and renders as given.
  return value === undefined || value === null ? (
    <span className="text-mute">&mdash;</span>
  ) : (
    <>{value}</>
  );
}

export function DataTable({
  columns,
  rows,
  /** Rendered instead of the table when `rows` is empty. */
  empty,
  caption,
}: {
  columns: Column[];
  rows: Row[];
  empty?: React.ReactNode;
  /** Screen-reader description of what the table lists. */
  caption: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      {/* Table layout, tablet and up. */}
      <div className="hidden overflow-x-auto rounded-2xl border border-line bg-paper md:block">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-line">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`eyebrow px-4 py-3.5 text-mute ${
                    c.align === "right" ? "text-right" : ""
                  } ${c.secondary ? "hidden lg:table-cell" : ""}`}
                >
                  {/* The eyebrow's leading square would repeat on every column
                      and read as noise, so it is suppressed in the header. */}
                  <span className="before:hidden">{c.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                // `relative` so a linked row can stretch its hit area across the whole
                // row via the `::after` below. Without it the link would only cover
                // the text in the first cell.
                className="relative border-b border-line transition-colors last:border-b-0 hover:bg-stone/60"
              >
                {columns.map((c, i) => (
                  <td
                    key={c.key}
                    className={`px-4 py-4 align-middle text-[0.9375rem] ${
                      c.align === "right" ? "text-right" : ""
                    } ${c.secondary ? "hidden lg:table-cell" : ""}`}
                  >
                    {/* The link wraps the first cell only. A nested <a> per
                        cell would make one row many tab stops. A next/link,
                        not a bare <a>: a bare anchor reloads the whole
                        document, header and all, on every row tapped. */}
                    {row.href && i === 0 ? (
                      <Link
                        href={row.href}
                        className="after:absolute after:inset-0 after:content-['']"
                      >
                        <Cell value={row.cells[c.key]} />
                      </Link>
                    ) : (
                      <Cell value={row.cells[c.key]} />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stacked layout, phones. Every column appears, labelled, so nothing is
          lost relative to the table above. */}
      <ul className="flex flex-col gap-2.5 md:hidden">
        {rows.map((row) => {
          const [lead, ...rest] = columns;
          return (
            <li
              key={row.id}
              className="relative rounded-xl border border-line bg-paper p-4"
            >
              <div className="mb-3 text-[0.9375rem]">
                {row.href ? (
                  <Link
                    href={row.href}
                    className="after:absolute after:inset-0 after:content-['']"
                  >
                    <Cell value={row.cells[lead.key]} />
                  </Link>
                ) : (
                  <Cell value={row.cells[lead.key]} />
                )}
              </div>
              <dl className="flex min-w-0 flex-col gap-2">
                {rest.map((c) => (
                  <div key={c.key} className="flex min-w-0 justify-between gap-4">
                    <dt className="eyebrow shrink-0 text-mute">
                      <span className="before:hidden">{c.label}</span>
                    </dt>
                    <dd className="min-w-0 text-right text-[0.875rem]">
                      <Cell value={row.cells[c.key]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          );
        })}
      </ul>
    </>
  );
}
