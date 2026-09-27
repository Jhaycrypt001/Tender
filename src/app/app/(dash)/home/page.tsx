import Link from "next/link";
import { PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { CopyValue } from "@/components/dash/copy";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { getBalance, getMerchant } from "@/lib/api/merchant";
import { listPayments } from "@/lib/api/payments";
import { chainLabel } from "@/lib/chains";

export const metadata = { title: "Home · Tender" };

export const dynamic = "force-dynamic";

/** How many recent payments the overview shows before deferring to Activity. */
const RECENT = 5;

/**
 * The overview.
 *
 * Three fetches, deliberately independent: a merchant whose balance endpoint
 * is down should still see their recent payments, and someone who has not set
 * a settlement address yet should still see their balance. Awaiting them
 * together and bailing on the first failure would turn one broken endpoint
 * into a blank screen.
 */
export default async function HomePage() {
  const [balance, merchant, recent] = await Promise.all([
    getBalance(),
    getMerchant(),
    listPayments({ limit: RECENT }),
  ]);

  const settled = balance.ok ? balance.data.settled : [];
  const unsettled = balance.ok ? balance.data.unsettled : [];

  return (
    <PageShell>
      <div className="mb-6">
        <p className="eyebrow mb-2">Overview</p>
        <h1 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] leading-[1.06] tracking-[-0.02em]">
          {merchant.ok && merchant.data.name
            ? `Welcome back, ${merchant.data.name.split(" ")[0]}`
            : "Your money"}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* The dark hero. Settled money is the one number a merchant opens
            this app to see, so it gets the weight and everything else sits
            beneath it. */}
        <Card tone="ink" pad="lg" marks>
          {/* Rendered inline rather than via CardHeader: that component sets
              its label `text-mute`, a grey tuned for the white cards that
              disappears against ink. */}
          <div className="mb-4">
            <h2 className="eyebrow text-paper/55">Settled on Monad</h2>
            <p className="mt-2 text-[0.8125rem] leading-relaxed text-paper/55">
              Landed, final, and yours to spend.
            </p>
          </div>

          {!balance.ok ? (
            <p className="text-[0.9375rem] leading-relaxed text-paper/70">
              Your balance could not be loaded. {balance.error.message}
            </p>
          ) : settled.length === 0 ? (
            <div>
              <p className="font-display text-[2.5rem] leading-none tracking-[-0.03em] text-paper/35">
                0.00
              </p>
              <p className="mt-3 text-[0.875rem] leading-relaxed text-paper/60">
                Nothing has settled yet. Your first payment lands here the
                moment it clears on Monad.
              </p>
            </div>
          ) : (
            /* One row per asset. There is no single total, because adding
               USDC to USDT would require a rate this screen does not have
               and must not invent. */
            <ul className="flex flex-col gap-3">
              {settled.map((b) => (
                <li key={b.asset} className="flex items-baseline gap-3">
                  <Money amount={b.amount} size="xl" className="text-paper" />
                  <span className="font-mono text-[0.75rem] uppercase tracking-[0.1em] text-paper/50">
                    {b.asset}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Unsettled sits inside the same card, dimmer. It is the same
              money one step earlier, not a separate figure to compare. */}
          {balance.ok && unsettled.length > 0 && (
            <div className="mt-5 border-t border-paper/12 pt-4">
              <p className="mb-2 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper/45">
                On its way
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
                {unsettled.map((b) => (
                  <li key={b.asset} className="flex items-baseline gap-1.5">
                    <Money amount={b.amount} className="text-paper/75" />
                    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper/45">
                      {b.asset}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-paper/50">
                Seen on chain, not yet final.
              </p>
            </div>
          )}
        </Card>

        {/* The light accent card, paired with the dark one. This is where
            money lands, so it sits beside the balance rather than buried in
            Settings — and it is the one place the verification gate is
            unavoidable. */}
        <Card className="bg-sand/10">
          <CardHeader
            label="Settles to"
            hint="Every payment converts to this asset and lands at this address."
          />

          {!merchant.ok ? (
            <p className="text-[0.875rem] leading-relaxed text-mute">
              Your settlement details could not be loaded.{" "}
              {merchant.error.message}
            </p>
          ) : !merchant.data.settlement_address ? (
            <div>
              <p className="text-[0.875rem] leading-relaxed text-mute">
                You have not set a settlement address yet. Payments cannot land
                until you do.
              </p>
              <Link
                href="/app/settings"
                className="mt-4 inline-flex items-center justify-center rounded-full bg-ink px-5 py-2.5 text-[0.875rem] text-paper transition-colors hover:bg-ink/90"
              >
                Set it up
              </Link>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-paper px-3.5 py-2.5">
                <code className="min-w-0 break-all font-mono text-[0.75rem]">
                  {merchant.data.settlement_address}
                </code>
                <CopyValue value={merchant.data.settlement_address} />
              </div>

              <dl className="mt-4 flex flex-col gap-2.5 text-[0.875rem]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[0.8125rem] text-mute">Asset</dt>
                  <dd className="font-mono text-[0.8125rem] uppercase tracking-[0.08em]">
                    {merchant.data.settlement_asset ?? "Not set"}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-[0.8125rem] text-mute">Tender fee</dt>
                  {/* fee_bps is basis points. 40 → 0.40%. Shown because a
                      merchant comparing processors wants it without hunting. */}
                  <dd className="font-mono text-[0.8125rem] tabular-nums">
                    {(merchant.data.fee_bps / 100).toFixed(2)}%
                  </dd>
                </div>
              </dl>

              {/* ⚠️ An unverified address must not receive money: behind
                  nothing but a session cookie, a stolen account would silently
                  redirect every future payment. This warning is the gate the
                  merchant sees; Settings carries the challenge itself. */}
              {!merchant.data.settlement_verified && (
                <div className="mt-4 rounded-xl border border-ink bg-paper px-3.5 py-3">
                  <p className="text-[0.8125rem] leading-relaxed">
                    <span aria-hidden="true" className="mr-1.5 text-sand">
                      &#9632;
                    </span>
                    This address has not been verified, so payments cannot
                    settle to it yet.
                  </p>
                  <Link
                    href="/app/settings"
                    className="mt-2.5 inline-block text-[0.8125rem] text-sand underline-offset-4 hover:underline"
                  >
                    Prove you own it &rarr;
                  </Link>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* The pill row: the handful of things a merchant actually starts from
          this screen. Secondary by design — the balance is the point. */}
      <nav aria-label="Quick actions" className="mt-4 flex flex-wrap gap-2">
        <Pill href="/app/checkout/new">New invoice</Pill>
        <Pill href="/app/links">Payment link</Pill>
        <Pill href="/app/pay/payout">Send a payout</Pill>
        <Pill href="/app/settings/developers">API keys</Pill>
      </nav>

      <div className="mt-8">
        <SectionHeader
          label="Recent"
          action={
            <Link
              href="/app/activity"
              className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              See all
            </Link>
          }
        />

        {!recent.ok ? (
          <ErrorState error={recent.error} />
        ) : recent.data.data.length === 0 ? (
          <Card tone="quiet">
            <p className="text-[0.875rem] leading-relaxed text-mute">
              No payments yet. Create an invoice and the first one shows up
              here as soon as it is seen on chain.
            </p>
          </Card>
        ) : (
          <DataTable
            columns={[
              { key: "when", label: "First seen" },
              { key: "from", label: "From" },
              { key: "sent", label: "Sent", align: "right" },
              { key: "tx", label: "Transaction", secondary: true },
              { key: "state", label: "State", align: "right" },
            ]}
            rows={recent.data.data.slice(0, RECENT).map(
              (p): Row => ({
                id: p.id,
                href: `/app/activity/${p.id}`,
                cells: {
                  when: <Timestamp value={p.first_seen_at} />,
                  from: chainLabel(p.from_chain),
                  sent: <Money amount={p.amount_in} maxDp={8} />,
                  tx: <Hash value={p.tx_hash} />,
                  state: <PaymentStatePill status={p.status} />,
                },
              }),
            )}
            empty="No payments yet."
            caption="Recent payments"
          />
        )}
      </div>
    </PageShell>
  );
}

/** One quick action. Local — the pill row exists only on this screen. */
function Pill({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-full border border-line bg-paper px-4 py-2 text-[0.8125rem] text-ink transition-colors hover:border-mute/50 hover:bg-stone"
    >
      {children}
    </Link>
  );
}
