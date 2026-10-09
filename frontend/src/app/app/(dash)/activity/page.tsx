import { PageHeader, PageShell } from "@/components/dash/shell";
import { LiveRefresh } from "@/components/dash/live-refresh";
import { Empty, ErrorState } from "@/components/dash/empty";
import { ActivityIcon, PlusIcon } from "@/components/dash/icons";
import { Cta } from "@/components/dash/cta";
import { Hash, Money, Timestamp } from "@/components/dash/money";
import { TxLink } from "@/components/dash/tx-link";
import { FiatMoney } from "@/components/dash/currency";
import { PaymentStatePill, TransferStatePill } from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { FilterTabs } from "@/components/dash/filter-tabs";
import { listPayments } from "@/lib/api/payments";
import { listTransfers } from "@/lib/api/transfers";
import { chainLabel } from "@/lib/chains";
import type { ListPaymentsQuery, Payment, Transfer } from "@/lib/api/types";

export const metadata = { title: "Activity · Tender" };

export const dynamic = "force-dynamic";

/**
 * The filters.
 *
 * ⚠️ These deliberately mix two different enums. "Seen on chain" and "Failed" are
 * PAYMENT states, but "Needs recovery" is an INVOICE state — there is no
 * NEEDS_RECOVERY payment status, because the payment itself succeeded and it
 * is the onward settlement that did not. Sending that pill as `status` would
 * quietly return nothing, so each filter names which field it queries.
 */
const FILTERS: { label: string; query: ListPaymentsQuery }[] = [
  { label: "All", query: {} },
  // Every payment that came in, whatever its state (each row shows it). Money out is "Outgoing".
  { label: "Incoming", query: {} },
  { label: "Seen on chain", query: { status: "DETECTED" } },
  { label: "Needs recovery", query: { invoice_status: "NEEDS_RECOVERY" } },
  { label: "Refunded", query: { status: "REFUNDED" } },
  { label: "Failed", query: { status: "FAILED" } },
];

/** Money going OUT (payouts, refunds, splits) is a different list from payments in, so it is its own tab. */
const SENT = "Outgoing";

/** How many of each kind one page loads. */
const LIST_SIZE = 50;

const KIND_LABEL: Record<Transfer["kind"], string> = { PAYOUT: "Payout", REFUND: "Refund", SPLIT: "Split" };

/** Where a transfer went: the recipient, or how many, and on which chain. */
function sentTo(t: Transfer): React.ReactNode {
  if (t.lines.length > 1) {
    const chains = new Set(t.lines.map((l) => l.dest?.chain_name ?? "Monad"));
    return `${t.lines.length} recipients · ${[...chains].join(", ")}`;
  }
  const line = t.lines[0];
  if (!line) return null;
  return (
    <span className="flex items-baseline gap-2">
      <Hash value={line.dest?.address ?? line.to} />
      <span className="text-mute">{line.dest?.chain_name ?? "Monad"}</span>
    </span>
  );
}

/** The Monad leg's state, unless it confirmed and something is still on its way to another chain. */
function sentState(t: Transfer): React.ReactNode {
  const dests = t.lines.map((l) => l.dest).filter((d) => !!d);
  if (t.status === "CONFIRMED" && dests.some((d) => d.status === "PENDING")) return <span className="text-[0.8125rem] text-mute">Arriving…</span>;
  if (t.status === "CONFIRMED" && dests.some((d) => d.status === "FAILED")) return <span className="text-[0.8125rem] text-ink">Not delivered</span>;
  return <TransferStatePill status={t.status} />;
}

/** When a transfer happened, for sorting: when it was sent, or created if it never was. */
const sentAt = (t: Transfer) => Date.parse(t.submitted_at ?? t.created_at);

/**
 * Money in and money out on one newest-first timeline, so a payout sits between the payments it
 * came after. Only transfers that actually moved money appear here (sent or confirmed); one that
 * expired unsigned or failed lives under "Outgoing" only.
 */
function Timeline({ payments, transfers }: { payments: Payment[]; transfers: Transfer[] }) {
  type Item = { at: number; row: Row };
  const items: Item[] = [
    ...payments.map((p): Item => ({
      at: Date.parse(p.first_seen_at),
      row: {
        id: `in-${p.id}`,
        href: `/app/activity/${p.id}`,
        cells: {
          when: <Timestamp value={p.first_seen_at} />,
          type: p.source === "deposit" ? "Deposit in" : "Payment in",
          where: `From ${chainLabel(p.from_chain)}`,
          amount: (
            <span className="text-ink">
              +<Money amount={p.amount_in} currency={p.asset_in ?? undefined} maxDp={8} />
            </span>
          ),
          result: p.amount_settled ? <FiatMoney amount={p.amount_settled} maxDp={6} /> : null,
          tx: <TxLink chain={p.from_chain} hash={p.tx_hash} />,
          state: <PaymentStatePill status={p.status} />,
        },
      },
    })),
    ...transfers
      .filter((t) => t.status === "SUBMITTED" || t.status === "CONFIRMED")
      .map((t): Item => ({
        at: sentAt(t),
        row: {
          id: `out-${t.id}`,
          href: `/app/activity/sent/${t.id}`,
          cells: {
            when: <Timestamp value={t.submitted_at ?? t.created_at} />,
            type: `${KIND_LABEL[t.kind]} out`,
            where: sentTo(t),
            amount: (
              <span className="text-mute">
                −<Money amount={t.total_amount} currency={t.asset} maxDp={6} />
              </span>
            ),
            result: null,
            tx: t.tx_hash ? <TxLink chain="monad" hash={t.tx_hash} /> : null,
            state: sentState(t),
          },
        },
      })),
  ].sort((a, b) => b.at - a.at);

  // Each list is the newest 50. If one list is full, anything from the OTHER list older than its
  // oldest entry would sit in a stretch where the full list's earlier items are missing, so the
  // timeline would show gaps that are not real. Cut both at the later of the two horizons.
  const oldest = (times: number[]) => (times.length ? Math.min(...times) : -Infinity);
  const horizon = Math.max(
    payments.length >= LIST_SIZE ? oldest(payments.map((p) => Date.parse(p.first_seen_at))) : -Infinity,
    transfers.length >= LIST_SIZE ? oldest(transfers.map(sentAt)) : -Infinity,
  );
  const shown = items.filter((i) => i.at >= horizon);

  if (items.length === 0) {
    return (
      <Empty
        icon={<ActivityIcon className="h-5 w-5" />}
        title="No activity yet"
        description="Payments appear here the moment a buyer's deposit is seen on chain, and money you send out appears beside them."
        action={
          <Cta href="/app/checkout/new">
            <PlusIcon className="h-3.5 w-3.5" />
            New invoice
          </Cta>
        }
      />
    );
  }

  return (
    <DataTable
      columns={[
        { key: "when", label: "When" },
        { key: "type", label: "Type" },
        { key: "where", label: "From / to" },
        { key: "amount", label: "Amount", align: "right" },
        { key: "result", label: "Settled", align: "right", secondary: true },
        { key: "tx", label: "Transaction", secondary: true },
        { key: "state", label: "State", align: "right" },
      ]}
      rows={shown.map((i) => i.row)}
      empty="No activity."
      caption="Money in and out, newest first"
    />
  );
}

/** The slug that appears in the URL, so a filtered view is linkable. */
function slug(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "-");
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const { filter } = await searchParams;
  const sending = filter === slug(SENT);
  const active = FILTERS.find((f) => slug(f.label) === filter) ?? FILTERS[0];

  // "All" is one timeline: money in AND money out, newest first. The other tabs are payments only.
  const everything = !sending && active.label === "All";
  const [result, sent] = await Promise.all([
    sending ? null : listPayments({ ...active.query, limit: LIST_SIZE }),
    sending || everything ? listTransfers(LIST_SIZE) : null,
  ]);

  return (
    <PageShell>
      <LiveRefresh />
      <PageHeader
        back="/app/home"
        eyebrow="Activity"
        title="Every coin, accounted for."
        description="Every payment in, every transfer out."
      />

      {/* Rendered regardless of the result: these are navigation, and hiding
          them behind a failed fetch makes the screen look broken, not empty. */}
      <FilterTabs
        label="Filter payments"
        tabs={(() => {
          const tabs = FILTERS.map((f) => ({
            label: f.label,
            href: f.label === "All" ? "/app/activity" : `/app/activity?filter=${slug(f.label)}`,
            on: !sending && f.label === active.label,
          }));
          // All · Incoming · Outgoing first, then the payment states.
          tabs.splice(2, 0, { label: SENT, href: `/app/activity?filter=${slug(SENT)}`, on: sending });
          return tabs;
        })()}
      />

      {everything && result?.ok ? (
        <Timeline payments={result.data.data} transfers={sent?.ok ? sent.data.data : []} />
      ) : sending && sent ? (
        !sent.ok ? (
          <ErrorState error={sent.error} />
        ) : sent.data.data.length === 0 ? (
          <Empty
            icon={<ActivityIcon className="h-5 w-5" />}
            title="Nothing sent yet"
            description="Payouts, refunds and splits you send from your wallet appear here."
            action={<Cta href="/app/pay">Send money</Cta>}
          />
        ) : (
          <DataTable
            columns={[
              { key: "when", label: "Sent" },
              { key: "kind", label: "Type" },
              { key: "to", label: "To" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "tx", label: "Transaction", secondary: true },
              { key: "state", label: "State", align: "right" },
            ]}
            rows={[...sent.data.data].sort((a, b) => sentAt(b) - sentAt(a)).map(
              (t): Row => ({
                id: t.id,
                href: `/app/activity/sent/${t.id}`,
                cells: {
                  when: <Timestamp value={t.submitted_at ?? t.created_at} />,
                  kind: KIND_LABEL[t.kind],
                  to: sentTo(t),
                  amount: <Money amount={t.total_amount} currency={t.asset} />,
                  tx: t.tx_hash ? <TxLink chain="monad" hash={t.tx_hash} /> : <span className="text-mute">&mdash;</span>,
                  state: sentState(t),
                },
              }),
            )}
            empty="Nothing sent."
            caption="Money sent out"
          />
        )
      ) : !result ? null : !result.ok ? (
        <ErrorState error={result.error} />
      ) : result.data.data.length === 0 ? (
        <Empty
          icon={<ActivityIcon className="h-5 w-5" />}
          title={
            active.label === "All"
              ? "No activity yet"
              : `Nothing ${active.label.toLowerCase()}`
          }
          description={
            active.label === "All"
              ? "Payments appear here the moment a buyer's deposit is seen on chain — before it has settled."
              : "No payments are in this state right now."
          }
          action={
            active.label === "All" ? (
              <Cta href="/app/checkout/new">
                <PlusIcon className="h-3.5 w-3.5" />
                New invoice
              </Cta>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          columns={[
            { key: "when", label: "First seen" },
            { key: "from", label: "From" },
            { key: "sent", label: "Sent", align: "right" },
            { key: "settled", label: "Settled", align: "right" },
            { key: "tx", label: "Transaction", secondary: true },
            { key: "state", label: "State", align: "right" },
          ]}
          rows={result.data.data.map(
            (p): Row => ({
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
                /**
                 * ⚠️ `amount_in` is in the SOURCE asset (BTC, SOL…), not the
                 * settlement currency, so it carries no currency prop and gets
                 * 8 decimal places. Labelling 0.00042 BTC as "USDC" would be a
                 * lie about what the buyer sent.
                 */
                sent: <Money amount={p.amount_in} currency={p.asset_in ?? undefined} maxDp={8} />,
                settled: p.amount_settled ? (
                  <FiatMoney amount={p.amount_settled} maxDp={6} />
                ) : null,
                tx: <TxLink chain={p.from_chain} hash={p.tx_hash} />,
                state: <PaymentStatePill status={p.status} />,
              },
            }),
          )}
          empty="No payments."
          caption="Payments"
        />
      )}
    </PageShell>
  );
}
