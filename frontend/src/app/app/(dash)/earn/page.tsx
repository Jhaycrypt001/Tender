import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { Empty, ErrorState } from "@/components/dash/empty";
import { EarnIcon } from "@/components/dash/icons";
import { Money, Timestamp } from "@/components/dash/money";
import { getPositions } from "@/lib/api/earn";

export const metadata = { title: "Treasury · Tender" };

export const dynamic = "force-dynamic";

/**
 * Settled revenue put to work.
 *
 * ⚠️ This screen READS. There is no Deposit button on it, and that is a
 * deliberate omission rather than an unfinished one.
 *
 * `deposit()` exists in `lib/api/earn.ts`, but depositing is an Intents
 * Connect flow: it rides along with settlement and is signed with ERC191 by
 * the merchant's wallet. None of that signing exists in this app yet. A
 * Deposit button wired to the bare endpoint would take an amount, post it,
 * and either fail or move real money by a path nothing here can show the
 * merchant — and the one thing worse than a missing button is a button that
 * moves money in a way the person pressing it cannot see.
 *
 * So positions are shown honestly, earnings included, and the screen says
 * plainly where depositing happens today.
 *
 * WARNING: both amounts render with `maxDp={8}`, not the default 2. A
 * position can be denominated in MON, which is an 18-decimal asset, and
 * `Money` TRUNCATES rather than rounds — so at the default an earned figure
 * of 18.227777777777777777 MON would display as 18.22 and quietly understate
 * what the merchant has made. Two decimal places are right for a fiat price
 * and wrong for an on-chain balance.
 */
export default async function EarnPage() {
  const result = await getPositions();

  return (
    <PageShell>
      <PageHeader
        back="/app/home"
        eyebrow="Treasury"
        title="Make idle revenue work."
        description="Settled revenue put to work on Monad, instead of sitting still."
      />

      {!result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.length === 0 ? (
        <Empty
          icon={<EarnIcon className="h-5 w-5" />}
          title="Nothing earning yet"
          description="Once revenue settles on Monad it can be put to work rather than sitting idle. Open positions appear here with what they have earned."
        />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {result.data.map((pos) => (
              <Card key={pos.id} tone="quiet">
                <CardHeader
                  label={pos.protocol}
                  hint={`Earning in ${pos.asset}`}
                />

                <div className="flex flex-col gap-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.8125rem] text-mute">APY</span>
                    {/* APY arrives as a string like "4.20" and is rendered as
                        given. It is variable, which the footnote says — a
                        rate shown without that word reads as a promise. */}
                    <span className="font-mono text-[1.125rem]">
                      {pos.apy}%
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.8125rem] text-mute">
                      Deposited
                    </span>
                    <span className="text-[0.9375rem]">
                      <Money
                        amount={pos.deposited}
                        currency={pos.asset}
                        maxDp={8}
                      />
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.8125rem] text-mute">Earned</span>
                    <span className="text-[0.9375rem]">
                      <Money
                        amount={pos.earned}
                        currency={pos.asset}
                        maxDp={8}
                      />
                    </span>
                  </div>
                </div>

                <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
                  Updated <Timestamp value={pos.updated_at} />. The rate is
                  variable and can change.
                </p>
              </Card>
            ))}
          </div>

          <div className="mt-7">
            <SectionHeader label="Adding to a position" />
            <Card tone="quiet">
              <p className="text-[0.9375rem] leading-relaxed">
                Depositing is not available from this screen yet.
              </p>
              <p className="mt-3 max-w-[60ch] text-[0.875rem] leading-relaxed text-mute">
                A deposit rides along with settlement itself rather than being
                a second transfer, so it is set up where money lands — on your{" "}
                <Link
                  href="/app/settings"
                  className="text-ink underline decoration-sand underline-offset-4"
                >
                  settlement address
                </Link>
                . Until that flow ships here, positions opened elsewhere are
                still shown above with what they have earned.
              </p>
            </Card>
          </div>
        </>
      )}
    </PageShell>
  );
}
