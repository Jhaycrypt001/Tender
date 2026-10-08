import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { CopyValue } from "@/components/dash/copy";
import { Hash, UsdMinimum } from "@/components/dash/money";
import { LiveRefresh } from "@/components/dash/live-refresh";
import { getDepositAddress } from "@/lib/api/deposit";
import { getMerchant } from "@/lib/api/merchant";
import { chainLabel } from "@/lib/chains";
import { CreateDepositAddress } from "./create";

export const metadata = { title: "Deposit address · Tender" };

export const dynamic = "force-dynamic";

/**
 * The standing deposit address.
 *
 * ⚠️ This is the one address a merchant SHOULD hand out. It is not the
 * settlement wallet: the settlement wallet is where the money ends up, and
 * sending to it directly does nothing on Monad (nothing converts it). Home used
 * to show the settlement wallet with a copy button, which is how that
 * mistake was made, so this page says plainly which address is which.
 *
 * Unlike an invoice it has no amount and no receipt: whatever arrives is paid
 * out as USDC on Monad and appears in Activity as a direct deposit. For an
 * exact bill, an invoice or payment link is still the right tool.
 */
export default async function DepositPage() {
  const [merchant, deposit] = await Promise.all([getMerchant(), getDepositAddress()]);

  const header = (
    <PageHeader
      back="/app/home"
      eyebrow="Deposit address"
      title="One address. Any payer."
      description="Money sent here from any chain arrives as USDC on Monad."
    />
  );

  if (!merchant.ok) {
    return (
      <PageShell>
        {header}
        <ErrorState error={merchant.error} />
      </PageShell>
    );
  }

  const m = merchant.data;
  const address = deposit.ok ? deposit.data : null;

  return (
    <PageShell>
      {address && <LiveRefresh />}
      {header}

      {!deposit.ok ? (
        <ErrorState error={deposit.error} />
      ) : !address ? (
        <Card tone="quiet">
          <CardHeader
            label="Not set up yet"
            hint="Yours to keep."
          />
          {m.settlement_address && m.settlement_verified ? (
            <>
              <p className="mb-5 max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
                We create an address that sends everything it receives to your
                settlement wallet, converted to USDC on Monad. It works the same
                every time, so you can put it on a profile, an invoice template
                or a website.
              </p>
              <CreateDepositAddress />
            </>
          ) : (
            <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
              Set and verify your settlement address first, so the money has
              somewhere safe to land.{" "}
              <Link
                href="/app/settings"
                className="text-sand underline-offset-4 hover:underline"
              >
                Open Settings
              </Link>
            </p>
          )}
        </Card>
      ) : (
        <>
          <Card tone="quiet">
            <CardHeader
              label="Your deposit address"
              hint="Works on every EVM chain below."
            />
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-paper px-3 py-2.5">
              <code className="min-w-0 break-all font-mono text-[0.8125rem]">
                {address.address}
              </code>
              <CopyValue value={address.address} />
            </div>
            <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
              Lands as {address.asset} on Monad in{" "}
              <Hash value={address.settles_to} className="text-ink" />, your
              settlement wallet. That wallet is the destination, not a place to
              send to.
            </p>
          </Card>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card tone="quiet">
              <CardHeader
                label="Accepted chains"
                hint="Minimums in USD."
              />
              {address.chains.length === 0 ? (
                <p className="text-[0.875rem] leading-relaxed text-mute">
                  No chain is quotable right now. The address is safe: check
                  back in a few minutes.
                </p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {address.chains.map((c) => (
                    <li
                      key={c.chain}
                      className="rounded-full border border-line px-3 py-1 text-[0.8125rem]"
                    >
                      {chainLabel(c.chain)}
                      {c.minimum && (
                        <span className="ml-1.5 text-mute">
                          min <UsdMinimum amount={c.minimum} />
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card tone="quiet">
              <CardHeader
                label="Good to know"
                hint="Good to know."
              />
              <ul className="flex flex-col gap-2.5 text-[0.875rem] leading-relaxed text-mute">
                <li>
                  Send a supported token on one of the chains listed. Other
                  tokens or chains may not arrive.
                </li>
                <li>
                  Network and swap costs come out of what lands. Tender takes
                  nothing.
                </li>
                <li>
                  There is no receipt and no amount check. For an exact bill,
                  use an{" "}
                  <Link
                    href="/app/checkout/new"
                    className="text-sand underline-offset-4 hover:underline"
                  >
                    invoice
                  </Link>{" "}
                  or a{" "}
                  <Link
                    href="/app/links"
                    className="text-sand underline-offset-4 hover:underline"
                  >
                    payment link
                  </Link>
                  .
                </li>
                <li>
                  Each deposit shows in{" "}
                  <Link
                    href="/app/activity"
                    className="text-sand underline-offset-4 hover:underline"
                  >
                    Activity
                  </Link>{" "}
                  as a direct deposit once it is seen, usually within a few
                  minutes.
                </li>
              </ul>
            </Card>
          </div>
        </>
      )}

      <div className="mt-7">
        <SectionHeader label="Which address is which" />
        <Card tone="quiet">
          <dl className="flex flex-col gap-3 text-[0.875rem] leading-relaxed">
            <div>
              <dt className="text-ink">Deposit address</dt>
              <dd className="text-mute">
                Where people send money. Converts and forwards everything it
                receives.
              </dd>
            </div>
            <div>
              <dt className="text-ink">Settlement wallet</dt>
              <dd className="text-mute">
                Your own wallet on Monad, where the USDC ends up. Money sent
                to it from another chain, like Base, is not converted.
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </PageShell>
  );
}
