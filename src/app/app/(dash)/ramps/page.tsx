import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card } from "@/components/dash/card";
import { Empty, ErrorState } from "@/components/dash/empty";
import { Money } from "@/components/dash/money";
import { getCorridors } from "@/lib/api/ramps";
import type { RampCorridor } from "@/lib/api/types";

export const metadata = { title: "Ramps · Tender" };

export const dynamic = "force-dynamic";

/**
 * Off-ramps: settled crypto out to a bank account.
 *
 * ⚠️ Most corridors are not live, and this screen says so rather than hiding
 * them. That is the plan's instruction and it is the right one: a corridor
 * marked COMING SOON reads as a product being built, while a bank payout form
 * that cannot pay out reads as a product that is broken — or worse, takes an
 * account number and leaves the merchant waiting for money that never moves.
 *
 * Hiding the unbuilt corridors entirely would be a third mistake: a merchant
 * in Nigeria needs to know their corridor is coming, not to conclude Tender
 * will never serve them and leave.
 */

/** One badge per state, so an unbuilt corridor can never read as ready. */
const BADGE: Record<RampCorridor["status"], { label: string; className: string }> =
  {
    LIVE: {
      label: "LIVE",
      // The only one that gets the accent. Ochre means "you can use this".
      className: "border-sand text-sand",
    },
    COMING_SOON: {
      label: "COMING SOON",
      className: "border-line text-mute",
    },
    NOT_OPEN: {
      label: "NOT OPEN",
      className: "border-line text-mute",
    },
  };

function StatusBadge({ status }: { status: RampCorridor["status"] }) {
  const b = BADGE[status] ?? BADGE.NOT_OPEN;
  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[0.6875rem] tracking-[0.08em] ${b.className}`}
    >
      {b.label}
    </span>
  );
}

export default async function RampsPage() {
  const result = await getCorridors();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Treasury"
        title="Ramps"
        description="Move settled revenue out to a bank account."
      />

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.length === 0 ? (
        <Empty
          title="No corridors yet"
          description="Off-ramp corridors appear here as they open, with the countries and currencies each one covers."
        />
      ) : (
        <>
          <ul className="grid gap-3 lg:grid-cols-2">
            {result.data.map((c) => (
              <li key={`${c.country}-${c.currency}`}>
                <Card tone="quiet">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.9375rem]">{c.country}</p>
                      <p className="mt-1 font-mono text-[0.8125rem] text-mute">
                        {c.currency}
                      </p>
                    </div>
                    <StatusBadge status={c.status} />
                  </div>

                  {/* Only shown when the API sent one. A missing cap is not
                      "unlimited" and must not be drawn as a number. */}
                  {c.daily_cap ? (
                    <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
                      Up to{" "}
                      <Money amount={c.daily_cap} currency={c.currency} /> a
                      day.
                    </p>
                  ) : null}
                </Card>
              </li>
            ))}
          </ul>

          <div className="mt-7">
            <SectionHeader label="Cashing out" />
            <Card tone="quiet">
              <p className="text-[0.9375rem] leading-relaxed">
                Bank details are not collected here yet.
              </p>
              <p className="mt-3 max-w-[60ch] text-[0.875rem] leading-relaxed text-mute">
                A corridor has to be live before an account can be attached to
                it, so there is no form on this page until yours opens. What
                works today is your{" "}
                <Link
                  href="/app/settings"
                  className="text-ink underline decoration-sand underline-offset-4"
                >
                  settlement address
                </Link>
                {" "}— revenue lands there on Monad and can be moved from a
                wallet you already control.
              </p>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
