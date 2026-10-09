import Link from "next/link";
import { cookies } from "next/headers";
import { PageShell, SectionHeader } from "@/components/dash/shell";
import { LiveRefresh } from "@/components/dash/live-refresh";
import BalanceCard from "@/components/dash/balance-card";
import { Card, CardCanvas } from "@/components/ui/animated-glow-card";
import { Cta } from "@/components/dash/cta";
import { SoonTag } from "@/components/dash/coming-soon";
import { AskCta } from "@/components/ask/ask-cta";
import { Empty, ErrorState } from "@/components/dash/empty";
import {
  ActivityIcon,
  CheckoutIcon,
  PayIcon,
  PlusIcon,
  RampsIcon,
} from "@/components/dash/icons";
import { Money, Timestamp } from "@/components/dash/money";
import { TxLink } from "@/components/dash/tx-link";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { getBalance, getMerchant } from "@/lib/api/merchant";
import { getDepositAddress } from "@/lib/api/deposit";
import { listPayments } from "@/lib/api/payments";
import type { ApiResult, Merchant } from "@/lib/api/types";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import { chainLabel } from "@/lib/chains";

export const metadata = { title: "Home · Tender" };

export const dynamic = "force-dynamic";

/** How many recent payments the overview shows before deferring to Activity. */
const RECENT = 5;

/**
 * The balance card's art, committed under `public/`.
 *
 * ⚠️ Never gate this on `fs.existsSync`. On Vercel, `public/` is served from
 * the CDN and is not on the server function's disk, so the check is always
 * false in production and the card silently falls back to its CSS rings.
 */
const CARD_ART = "/img/card.png";

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
  const [balance, merchant, recent, deposit, jar] = await Promise.all([
    getBalance(),
    getMerchant(),
    listPayments({ limit: RECENT }),
    getDepositAddress(),
    cookies(),
  ]);

  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  const first = session?.name.trim().split(/\s+/)[0] ?? "";
  const m = merchant.ok ? merchant.data : null;


  return (
    <PageShell>
      <LiveRefresh />
      <Notice merchant={merchant} />

      <div className="mb-7">
        <p className="eyebrow mb-3.5 text-mute">Overview</p>
        <h1 className="font-display text-[clamp(2rem,1.45rem+2.3vw,2.875rem)] leading-[1.04] tracking-[-0.025em]">
          {first ? `Welcome back, ${first}.` : "Welcome back."}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* The one lit surface on the screen: light runs its edge because
            this is the number the merchant came to check. */}
        <CardCanvas className="h-full">
          <Card>
            <BalanceCard
              error={
                balance.ok
                  ? null
                  : balance.error.message || "The request did not complete."
              }
              total={balance.ok ? balance.data.display_total : null}
              settled={balance.ok ? balance.data.settled : []}
              unsettled={balance.ok ? balance.data.unsettled : []}
              asset={m?.settlement_asset}
              address={m?.settlement_address}
              depositAddress={deposit.ok ? (deposit.data?.address ?? null) : undefined}
              addressKnown={merchant.ok}
              verified={m?.settlement_verified ?? false}
              art={CARD_ART}
            />
          </Card>
        </CardCanvas>

        {/* The light partner to the dark card: one next move, not a menu.
            Payment links are the shortest path from signing up to being paid,
            so that is the move it offers. */}
        <section className="crosshairs relative flex flex-col rounded-[1.25rem] border border-sand/25 bg-sand/[0.09] p-6 text-ink md:p-7">
          <p className="font-mono text-[0.6875rem] uppercase leading-none tracking-[0.24em] text-sand">
            No code needed
          </p>
          <h2 className="mt-5 font-display text-[1.625rem] leading-[1.1] tracking-[-0.02em]">
            Share one link. Take any coin.
          </h2>
          <p className="mt-3 max-w-[34ch] text-[0.875rem] leading-relaxed text-mute">
            Each buyer gets a fresh invoice. Put it in a bio, email or QR.
          </p>
          <div className="mt-auto pt-7">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <Cta href="/app/links">
                <PlusIcon className="h-3.5 w-3.5" />
                Create a link
              </Cta>
              <Link
                href="/app/deposit"
                className="text-[0.8125rem] text-mute underline-offset-4 hover:text-ink hover:underline"
              >
                or use your deposit address
              </Link>
            </div>
          </div>
        </section>
      </div>

      <nav
        aria-label="Quick actions"
        className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        <Cta href="/app/checkout" tone="outline">
          <CheckoutIcon className="h-4 w-4" />
          Invoices
        </Cta>
        <Cta href="/app/pay/refund" tone="outline">
          <PayIcon className="h-4 w-4" />
          Refund
        </Cta>
        {/* Cash out, not API keys: this row is for things a merchant does
            every day, and keys are a one-time developer setup that already
            lives under the avatar menu → Developers. */}
        <Cta href="/app/ramps" tone="outline">
          <RampsIcon className="h-4 w-4" />
          Cash out
          <SoonTag className="ml-1" />
        </Cta>
        <AskCta />
      </nav>

      <div className="mt-10">
        <SectionHeader
          label="Recent"
          action={
            <Link
              href="/app/activity"
              // Padding with an equal negative margin: a thumb-sized target, the same look.
              className="-my-2.5 py-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              See all
            </Link>
          }
        />

        {!recent.ok ? (
          <ErrorState error={recent.error} />
        ) : recent.data.data.length === 0 ? (
          <Empty
            icon={<ActivityIcon className="h-5 w-5" />}
            title="No payments yet"
            description="Your first payment shows up here."
            action={
              <Cta href="/app/checkout/new">
                <PlusIcon className="h-3.5 w-3.5" />
                New invoice
              </Cta>
            }
          />
        ) : (
          <DataTable
            columns={[
              { key: "when", label: "First seen" },
              { key: "from", label: "From" },
              { key: "sent", label: "Sent", align: "right" },
              { key: "tx", label: "Transaction", secondary: true },
              { key: "state", label: "State", align: "right" },
            ]}
            rows={recent.data.data.slice(0, RECENT).map((p): Row => ({
              id: p.id,
              href: `/app/activity/${p.id}`,
              cells: {
                when: <Timestamp value={p.first_seen_at} />,
                from: (
                  <>
                    {chainLabel(p.from_chain)}
                    {p.source === "deposit" && (
                      <span className="ml-2 rounded-full border border-line px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-mute">
                        Deposit
                      </span>
                    )}
                  </>
                ),
                sent: <Money amount={p.amount_in} currency={p.asset_in ?? undefined} maxDp={8} />,
                tx: <TxLink chain={p.from_chain} hash={p.tx_hash} />,
                state: <PaymentStatePill status={p.status} />,
              },
            }))}
            empty="No payments yet."
            caption="Recent payments"
          />
        )}
      </div>
    </PageShell>
  );
}

/**
 * The strip above the greeting.
 *
 * Anything blocking money from landing outranks news, so the settlement
 * problems are checked first and the product note only shows when there is
 * nothing to fix. ⚠️ The unverified case is the gate that keeps a hijacked
 * session from silently redirecting payouts — it must stay unmissable.
 */
function Notice({ merchant }: { merchant: ApiResult<Merchant> }) {
  const notice = !merchant.ok
    ? {
        tag: "Error",
        text: `Your settlement details could not be loaded. ${merchant.error.message}`,
        href: "/app/settings",
        warn: true,
      }
    : !merchant.data.settlement_address
      ? {
          tag: "Set up",
          text: "Set a settlement address to get paid.",
          href: "/app/settings",
          warn: true,
        }
      : !merchant.data.settlement_verified
        ? {
            tag: "Verify",
            text: "Verify your settlement address.",
            href: "/app/settings",
            warn: true,
          }
        : {
            tag: "New",
            text: "Share one link. Get paid from any chain.",
            href: "/app/links",
            warn: false,
          };

  return (
    <Link
      href={notice.href}
      className="group mb-8 flex items-center gap-3 rounded-2xl border border-line bg-paper py-1.5 pl-1.5 pr-4 transition-colors hover:border-ink/25"
    >
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[0.625rem] uppercase leading-none tracking-[0.14em] ${
          notice.warn ? "bg-sand text-paper" : "bg-ink text-paper"
        }`}
      >
        {notice.tag}
      </span>
      <span className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-ink">
        {notice.text}
      </span>
      <span
        aria-hidden="true"
        className="shrink-0 text-mute transition-transform group-hover:translate-x-0.5"
      >
        &rarr;
      </span>
    </Link>
  );
}
