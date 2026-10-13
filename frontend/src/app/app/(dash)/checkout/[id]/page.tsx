import Link from "next/link";
import { LiveRefresh } from "@/components/dash/live-refresh";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { CopyValue } from "@/components/dash/copy";
import { Money, Timestamp, UsdMinimum } from "@/components/dash/money";
import { TxLink } from "@/components/dash/tx-link";
import { FiatMoney } from "@/components/dash/currency";
import {
  INVOICE_STATUS_HELP,
  InvoiceStatePill,
  PaymentStatePill,
} from "@/components/dash/state-pill";
import { DataTable, type Row } from "@/components/dash/table";
import { QRCode } from "@/components/pay/qr";
import { NfcWrite } from "@/components/dash/nfc-write";
import { getInvoice } from "@/lib/api/invoices";
import { isDollarInvoice, overpaidRefund } from "@/lib/overpaid";
import { APP_URL } from "@/lib/auth";
import { chainLabel } from "@/lib/chains";
import { fromMicro, toMicro } from "@/lib/micro";

export const metadata = { title: "Invoice · Tender" };

export const dynamic = "force-dynamic";

/**
 * One invoice, from the merchant's side.
 *
 * The job of this screen is to hand over the pay link. Everything else —
 * status, addresses, payments — is reconciliation, and sits below it.
 *
 * ⚠️ The link is built from `token`, never `id`. The id is enumerable and
 * merchant-private; putting it in a URL a buyer holds would let anyone walk
 * the merchant's invoices.
 */
export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getInvoice(id);

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader
          back="/app/checkout"
          eyebrow="Get paid"
          title="Invoice"
          actions={
            <Link
              href="/app/checkout"
              className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
            >
              Back
            </Link>
          }
        />
        <ErrorState error={result.error} />
      </PageShell>
    );
  }

  const invoice = result.data;
  const payUrl = `${APP_URL}/pay/${invoice.token}`;
  const payments = invoice.payments ?? [];
  const settledPayments = payments.filter((p) => p.status === "SETTLED");
  // Overpaid: refund only the extra, worked out across every payment (they add up), on the payment that
  // went over. Without a figure (not a dollar invoice) the latest settled payment is offered in full.
  const suggestion = invoice.status === "OVERPAID" ? overpaidRefund(invoice) : null;
  const extra = settledPayments.find((p) => p.id === suggestion?.paymentId) ?? settledPayments[settledPayments.length - 1];
  const difference = suggestion?.amount ?? "";
  // A dollar invoice with nothing extra left to return, and a refund on record: it has gone back.
  const extraReturned =
    invoice.status === "OVERPAID" && isDollarInvoice(invoice) && !suggestion && settledPayments.some((p) => Number(p.refunded_amount ?? 0) > 0);
  // Overpaid by a payment that has not landed yet: nothing extra is in the wallet to send back, so offering
  // the latest settled payment would refund money the buyer owed.
  const extraArriving = invoice.status === "OVERPAID" && !suggestion && !extraReturned && payments.some((p) => p.status === "DETECTED");

  // Payments add up: how much has settled so far, and how much of the invoice is still unpaid. Dollar invoices only,
  // so the figures share a unit.
  let shortfall = "";
  const received = invoice.amount_received ?? "";
  if (received && ["USD", "USDC"].includes(invoice.currency.toUpperCase())) {
    const got = toMicro(received);
    const due = toMicro(invoice.amount_expected);
    if (got !== null && due !== null && got > BigInt(0) && due > got) shortfall = fromMicro(due - got);
  }

  const rows: Row[] = payments.map((p) => ({
    id: p.id,
    href: `/app/activity/${p.id}`,
    cells: {
      when: <Timestamp value={p.first_seen_at} />,
      from: chainLabel(p.from_chain),
      sent: <Money amount={p.amount_in} currency={p.asset_in ?? undefined} maxDp={8} />,
      settled: p.amount_settled ? (
        <FiatMoney amount={p.amount_settled} currency={invoice.currency} maxDp={6} />
      ) : (
        <span className="text-mute">&mdash;</span>
      ),
      tx: <TxLink chain={p.from_chain} hash={p.tx_hash} />,
      state: <PaymentStatePill status={p.status} />,
    },
  }));

  return (
    <PageShell>
      <LiveRefresh />
      <PageHeader
        back="/app/checkout"
        eyebrow={`Invoice ${invoice.reference}`}
        title={`${invoice.amount_expected} ${invoice.currency}`}
        actions={<InvoiceStatePill status={invoice.status} />}
      />

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        {/* The handover. First on the page and first in the DOM, because it is
            the only thing the merchant came here to do. */}
        <Card marks>
          <CardHeader
            label="Send this to your buyer"
            hint="Opens on any phone. No account needed."
          />

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0 rounded-2xl border border-line bg-paper p-3">
              <QRCode value={payUrl} size={148} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-stone/60 px-3.5 py-2.5">
                <code className="min-w-0 break-all font-mono text-[0.8125rem]">
                  {payUrl}
                </code>
                <CopyValue value={payUrl} label="Copy link" />
              </div>

              <p className="mt-3 text-[0.8125rem] leading-relaxed text-mute">
                {INVOICE_STATUS_HELP[invoice.status]}
              </p>

              <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
                Expires <Timestamp value={invoice.expires_at} />. After that the
                link stops accepting payment.
              </p>

              {/* Buyer in the room: put the link on a sticker they can tap. */}
              {(invoice.status === "PENDING" || invoice.status === "DETECTED") && (
                <div className="mt-4 border-t border-line pt-4">
                  <NfcWrite url={payUrl} label="Write to NFC sticker" />
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card tone="quiet">
          <CardHeader
            label="Deposit addresses"
            hint="One per chain."
          />
          {invoice.addresses.length === 0 ? (
            <p className="text-[0.875rem] leading-relaxed text-mute">
              No addresses were minted for this invoice.
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {invoice.addresses.map((a) => (
                <li key={a.chain} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.875rem]">{chainLabel(a.chain)}</span>
                    {a.minimum && (
                      <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-mute">
                        MIN <UsdMinimum amount={a.minimum} />
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2">
                    <code className="min-w-0 break-all font-mono text-[0.75rem]">
                      {a.address}
                    </code>
                    <CopyValue value={a.address} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {shortfall && (invoice.status === "DETECTED" || invoice.status === "UNDERPAID") && (
        <Card tone="quiet" className="mt-4">
          <CardHeader
            label={invoice.status === "DETECTED" ? "Partially paid" : "Underpaid"}
            hint={`${received} of ${invoice.amount_expected} ${invoice.currency} received`}
          />
          {invoice.status === "DETECTED" ? (
            <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
              {shortfall} {invoice.currency} is still to pay. Payments add up, so the buyer can send the rest, on any chain,
              before the invoice closes and it will settle. Each payment still has to meet that chain&apos;s minimum.
            </p>
          ) : (
            <>
              <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
                The invoice closed with {shortfall} {invoice.currency} unpaid. What arrived is in your wallet. Ask for the
                rest with a new invoice, or send what arrived back.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/app/checkout/new?amount=${shortfall}&currency=${invoice.currency.toUpperCase()}`}
                  className="inline-flex rounded-full bg-ink px-4 py-2 text-[0.875rem] text-paper"
                >
                  Invoice the shortfall ({shortfall})
                </Link>
                {settledPayments.map((p) => (
                  <Link
                    key={p.id}
                    href={`/app/pay/refund?payment=${p.id}`}
                    className="inline-flex rounded-full border border-line px-4 py-2 text-[0.875rem]"
                  >
                    {settledPayments.length > 1 && p.amount_settled
                      ? `Refund ${p.amount_settled} received`
                      : "Refund what was received"}
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {extraReturned && (
        <Card tone="quiet" className="mt-4">
          <CardHeader label="Overpaid" hint="The buyer sent more than the amount due." />
          <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">The extra has been sent back.</p>
        </Card>
      )}

      {extraArriving && (
        <Card tone="quiet" className="mt-4">
          <CardHeader label="Overpaid" hint="The buyer sent more than the amount due." />
          <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
            The extra payment is still on its way. Once it lands you can send it back from here.
          </p>
        </Card>
      )}

      {invoice.status === "OVERPAID" && extra && !extraReturned && !extraArriving && (
        <Card tone="quiet" className="mt-4">
          <CardHeader label="Overpaid" hint="The buyer sent more than the amount due." />
          <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
            {difference
              ? `${settledPayments.length > 1 ? "Together their payments came to" : "They sent"} ${difference} more than the ${invoice.amount_expected} ${invoice.currency} due. Refund the difference.`
              : `They sent more than ${invoice.amount_expected} ${invoice.currency}. Refund the difference.`}
          </p>
          <Link
            href={`/app/pay/refund?payment=${extra.id}${difference ? `&amount=${difference}` : ""}`}
            className="mt-4 inline-flex rounded-full bg-ink px-4 py-2 text-[0.875rem] text-paper"
          >
            Refund the extra
          </Link>
        </Card>
      )}

      <div className="mt-7">
        <SectionHeader label="Payments against this invoice" />
        {/* One row per deposit: Aurora quotes and pays out each one on its own. The invoice
            is judged on their total, shown above as received against expected. */}
        <DataTable
          columns={[
            { key: "when", label: "First seen" },
            { key: "from", label: "From" },
            { key: "sent", label: "Sent", align: "right" },
            { key: "settled", label: "Settled", align: "right" },
            { key: "tx", label: "Transaction", secondary: true },
            { key: "state", label: "State", align: "right" },
          ]}
          rows={rows}
          empty="Nothing has arrived yet. This fills in as the buyer pays."
          caption={`Payments against invoice ${invoice.reference}`}
        />
      </div>
    </PageShell>
  );
}
