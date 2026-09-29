import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { cookies } from "next/headers";
import { PageShell, SectionHeader } from "@/components/dash/shell";
import BalanceCard from "@/components/dash/balance-card";
import { Cta } from "@/components/dash/cta";
import { Empty, ErrorState } from "@/components/dash/empty";
import {
  ActivityIcon,
  AskIcon,
  CheckoutIcon,
  PayIcon,
  PlusIcon,
} from "@/components/dash/icons";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { PaymentStatePill } from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { getBalance, getMerchant } from "@/lib/api/merchant";
import { listPayments } from "@/lib/api/payments";
import type { ApiResult, Merchant } from "@/lib/api/types";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import { chainLabel } from "@/lib/chains";

export const metadata = { title: "Home · Tender" };

export const dynamic = "force-dynamic";

/** How many recent payments the overview shows before deferring to Activity. */
const RECENT = 5;

/**
 * The balance card's art. Generated separately and dropped in by hand; until
 * the file exists the card draws its own CSS ground, so nothing here breaks.
 */
const CARD_ART = "/img/dash/balance-card.png";

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
  const [balance, merchant, recent, jar] = await Promise.all([
    getBalance(),
    getMerchant(),
    listPayments({ limit: RECENT }),
    cookies(),
  ]);

  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);
  const first = session?.name.trim().split(/\s+/)[0] ?? "";
  const m = merchant.ok ? merchant.data : null;

  // Checked on the server, per request: dropping the PNG in is the whole
  // upgrade, with no code change and no broken-image flash before it exists.
  const art = fs.existsSync(path.join(process.cwd(), "public", CARD_ART))
    ? CARD_ART
    : null;

  return (
    <PageShell>
      <Notice merchant={merchant} />

      <div className="mb-7">
        <p className="eyebrow mb-3.5 text-mute">Overview</p>
        <h1 className="font-display text-[clamp(2rem,1.45rem+2.3vw,2.875rem)] leading-[1.04] tracking-[-0.025em]">
          {first ? `Welcome back, ${first}.` : "Welcome back."}
        </h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <BalanceCard
          error={balance.ok ? null : balance.error.message || "The request did not complete."}
          total={balance.ok ? balance.data.display_total : null}
          settled={balance.ok ? balance.data.settled : []}
          unsettled={balance.ok ? balance.data.unsettled : []}
          asset={m?.settlement_asset}
          address={m?.settlement_address}
          addressKnown={merchant.ok}
          verified={m?.settlement_verified ?? false}
          art={art}
        />

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
            A payment link opens a fresh invoice for every buyer. Put it in a
            bio, an email, or a QR by the till.
          </p>
          <div className="mt-auto pt-7">
            <Cta href="/app/links">
              <PlusIcon className="h-3.5 w-3.5" />
              Create a link
            </Cta>
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
        <Cta href="/app/settings/developers" tone="outline">
          <span aria-hidden="true" className="font-mono text-[0.8125rem] leading-none">
            {"{}"}
          </span>
          API keys
        </Cta>
        <Cta href="/app/ask" tone="outline">
          <AskIcon className="h-4 w-4" />
          Ask
        </Cta>
      </nav>

      <div className="mt-10">
        <SectionHeader
          label="Recent"
          action={
            <Link
              href="/app/activity"
              className="font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-mute underline-offset-4 hover:text-ink hover:underline"
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
            description="Create an invoice and the first payment shows up here the moment it is seen on chain."
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
          text: "Payments cannot land until you set a settlement address.",
          href: "/app/settings",
          warn: true,
        }
      : !merchant.data.settlement_verified
        ? {
            tag: "Verify",
            text: "Your settlement address is not verified yet, so nothing can settle to it.",
            href: "/app/settings",
            warn: true,
          }
        : {
            tag: "New",
            text: "Payment links: one URL any buyer can pay from any chain.",
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
