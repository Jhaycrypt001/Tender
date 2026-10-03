import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { ReadOnlyField } from "@/components/dash/field";
import { CopyValue } from "@/components/dash/copy";
import { DataTable, type Column, type Row } from "@/components/dash/table";
import { FilterTabs } from "@/components/dash/filter-tabs";
import { Timestamp } from "@/components/dash/money";
import { getMerchant, listApiKeys, listWebhookDeliveries } from "@/lib/api/merchant";
import type { WebhookDelivery, WebhookDeliveryStatus } from "@/lib/api/types";
import { ApiKeysPanel } from "./keys";
import { SigningSecretPanel } from "./secret";
import { WebhookPanel } from "./webhook";

export const metadata = { title: "Developers · Tender" };

export const dynamic = "force-dynamic";

/** The base URL a merchant points their own client at. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.tender.to";

/**
 * Developer settings: the endpoint, the webhook, API keys, the signing secret,
 * and which webhook deliveries never arrived.
 *
 * ⚠️ Keys and the signing secret are shown ONCE, by the action that creates
 * them, and never read back: the server keeps only a hash of a key. The list
 * here is prefixes only. None of these keys is what the dashboard itself uses
 * (that is the platform key, server-side), so revoking them all never locks
 * the merchant out of this page.
 */
export default async function DevelopersPage({
  searchParams,
}: {
  searchParams: Promise<{ deliveries?: string }>;
}) {
  const { deliveries: filterParam } = await searchParams;
  const filter = DELIVERY_FILTERS.find((f) => f.value === filterParam)?.value;

  const [result, keys, deliveries] = await Promise.all([
    getMerchant(),
    listApiKeys(),
    listWebhookDeliveries(filter),
  ]);

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader
          back="/app/settings"
          eyebrow="Settings · Developers"
          title="Wire Tender into your stack."
          description="How your server talks to Tender, and how Tender talks back."
        />
        <ErrorState error={result.error} />
      </PageShell>
    );
  }

  const m = result.data;

  return (
    <PageShell>
      <PageHeader
        back="/app/settings"
        eyebrow="Settings · Developers"
        title="Wire Tender into your stack."
        description="How your server talks to Tender, and how Tender talks back."
        actions={
          <Link
            href="/app/settings"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Settings
          </Link>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card tone="quiet">
          <CardHeader
            label="Your endpoint"
            hint="Point your client at this. Every merchant route needs a bearer token."
          />
          <div className="flex flex-col gap-5">
            <ReadOnlyField
              label="Base URL"
              action={<CopyValue value={API_BASE} />}
            >
              <code className="font-mono text-[0.8125rem]">{API_BASE}</code>
            </ReadOnlyField>
            <ReadOnlyField
              label="Merchant ID"
              action={<CopyValue value={m.id} />}
            >
              <code className="font-mono text-[0.8125rem]">{m.id}</code>
            </ReadOnlyField>
          </div>
          <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
            Full reference in the{" "}
            <Link
              href="/docs"
              className="text-ink underline decoration-sand underline-offset-4"
            >
              docs
            </Link>
            .
          </p>
        </Card>

        <WebhookPanel url={m.webhook_url ?? ""} />
      </div>

      <div className="mt-7">
        <SectionHeader label="Keys and secrets" />
        <div className="grid gap-4 lg:grid-cols-2">
          {keys.ok ? <ApiKeysPanel keys={keys.data.data} /> : <ErrorState error={keys.error} />}
          <SigningSecretPanel />
        </div>
      </div>

      <div className="mt-7">
        <SectionHeader label="Webhook deliveries" />
        <FilterTabs
          label="Filter deliveries"
          tabs={[
            { label: "All", href: "/app/settings/developers", on: !filter },
            ...DELIVERY_FILTERS.map((f) => ({
              label: f.label,
              href: `/app/settings/developers?deliveries=${f.value}`,
              on: filter === f.value,
            })),
          ]}
        />
        {deliveries.ok ? (
          <DataTable
            caption="Recent webhook deliveries"
            columns={DELIVERY_COLUMNS}
            rows={deliveries.data.data.map(deliveryRow)}
            empty={
              <Card tone="quiet">
                <p className="text-[0.875rem] leading-relaxed text-mute">
                  {filter === "failed"
                    ? "No failed deliveries. Every event Tender gave up on would be listed here."
                    : filter
                      ? `No ${filter} deliveries.`
                      : "No deliveries yet. They appear here once a payment changes state and your endpoint is set."}
                </p>
              </Card>
            }
          />
        ) : (
          <ErrorState error={deliveries.error} />
        )}
      </div>
    </PageShell>
  );
}

/* -------------------------------------------------------------------------- */
/* Webhook deliveries                                                          */
/* -------------------------------------------------------------------------- */

const DELIVERY_FILTERS: { value: WebhookDeliveryStatus; label: string }[] = [
  { value: "failed", label: "Failed" },
  { value: "retrying", label: "Retrying" },
  { value: "delivered", label: "Delivered" },
];

const DELIVERY_COLUMNS: Column[] = [
  { key: "event", label: "Event" },
  { key: "status", label: "Status" },
  { key: "attempts", label: "Attempts", align: "right" },
  { key: "error", label: "Last error", secondary: true },
  { key: "when", label: "When" },
];

/**
 * Failed is the only loud state: those events will never be sent again, so the
 * merchant has to act (fix the endpoint, then reconcile from Activity).
 */
const STATUS_STYLE: Record<WebhookDeliveryStatus, { label: string; className: string }> = {
  delivered: { label: "Delivered", className: "border-sand/25 bg-sand/12 text-[#8a5c1d]" },
  retrying: { label: "Retrying", className: "border-ink/12 bg-ink/[0.06] text-ink" },
  failed: { label: "Failed", className: "border-ink bg-ink text-paper" },
};

function deliveryRow(d: WebhookDelivery): Row {
  const s = STATUS_STYLE[d.status];
  return {
    id: d.id,
    cells: {
      event: (
        <span className="flex flex-col">
          <code className="font-mono text-[0.8125rem]">{d.event}</code>
          <span className="font-mono text-[0.75rem] text-mute">{d.invoice_id}</span>
        </span>
      ),
      status: (
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[0.75rem] ${s.className}`}>
          {s.label}
        </span>
      ),
      attempts: <span className="tabular-nums">{d.attempts}</span>,
      error: d.last_error ? <span className="text-[0.8125rem] text-mute">{d.last_error}</span> : null,
      when: d.delivered_at ? (
        <Timestamp value={d.delivered_at} />
      ) : d.next_retry_at ? (
        <span className="text-[0.8125rem]">
          next try <Timestamp value={d.next_retry_at} />
        </span>
      ) : (
        <Timestamp value={d.created_at} />
      ),
    },
  };
}
