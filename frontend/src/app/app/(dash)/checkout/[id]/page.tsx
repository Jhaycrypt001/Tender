import Link from "next/link";
import { LiveRefresh } from "@/components/dash/live-refresh";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { CopyValue } from "@/components/dash/copy";
import { Hash, Money, Timestamp, UsdMinimum } from "@/components/dash/money";
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
  // The payment to refund: the latest settled one. With a single payment it is that one (the buyer paid too much in one go).
  const settledPayments = payments.filter((p) => p.status === "SETTLED");
  const extra = settledPayments[settledPayments.length - 1];
  // One payment that was too large: prefill only the difference. Only when the invoice is in a
  // dollar currency, so the figure is in the same unit as what settled; otherwise the full payment is offered.
  let difference = "";
  if (settledPayments.length === 1 && extra?.amount_settled && ["USD", "USDC"].includes(invoice.currency.toUpperCase())) {
    const paid = toMicro(extra.amount_settled);
    const due = toMicro(invoice.amount_expected);
    if (paid !== null && due !== null && paid > due) difference = fromMicro(paid - due);
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
      tx: <Hash value={p.tx_hash} />,
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

      {invoice.status === "OVERPAID" && extra && (
        <Card tone="quiet" className="mt-4">
          <CardHeader label="Overpaid" hint="The buyer sent more than the amount due." />
          <p className="max-w-[56ch] text-[0.875rem] leading-relaxed text-mute">
            {payments.filter((p) => p.status === "SETTLED").length > 1
              ? "A second payment arrived after this invoice settled. You can send it back."
              : difference
                ? `They sent ${difference} more than the ${invoice.amount_expected} ${invoice.currency} due. Refund the difference.`
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
        {/* ⚠️ Rendered as a list, never summed. Aurora quotes each deposit
            independently and cannot batch two partial payments into one
            settlement, so two half-payments are two rows — adding them up and
            calling the invoice paid would be wrong. */}
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
