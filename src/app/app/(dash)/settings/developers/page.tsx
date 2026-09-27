import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { ReadOnlyField } from "@/components/dash/field";
import { CopyValue } from "@/components/dash/copy";
import { getMerchant } from "@/lib/api/merchant";
import { WebhookPanel } from "./webhook";

export const metadata = { title: "Developers · Tender" };

export const dynamic = "force-dynamic";

/** The base URL a merchant points their own client at. */
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.tender.to";

/**
 * Developer settings.
 *
 * ⚠️ There is no API-key management on this screen, and that is deliberate.
 *
 * The §5 contract has no key endpoint — no create, no list, no rotate. A key
 * could therefore only be shown here by inventing one in the browser, and a
 * credential that the server has never seen authenticates nothing: the
 * merchant would paste it into their backend, every request would 401, and
 * they would have no way to tell a fake key from a revoked one. Worse, the
 * one key this app *does* hold is `TENDER_API_KEY`, which is Tender's own
 * server-side credential and must never reach a browser — rendering "your API
 * key" on a page is exactly how that leaks.
 *
 * So this screen ships the two things that are real today — the endpoint a
 * merchant calls, and the webhook Tender delivers to — and states plainly that
 * key management is not available yet. An honest gap reads as unfinished; a
 * fabricated key reads as finished right up until it costs someone a payment.
 */
export default async function DevelopersPage() {
  const result = await getMerchant();

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Settings · Developers"
          title="Developers"
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
        eyebrow="Settings · Developers"
        title="Developers"
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
        <SectionHeader label="API keys" />
        <Card tone="quiet">
          {/* The honest empty state. See the note at the top of this file for
              why there is no key here to show. */}
          <p className="text-[0.9375rem] leading-relaxed">
            Key management is not available yet.
          </p>
          <p className="mt-3 max-w-[60ch] text-[0.875rem] leading-relaxed text-mute">
            Creating, rotating and revoking keys lands with the API. Until then
            your key is issued directly — a key shown on this page before the
            server can mint one would authenticate nothing.
          </p>
          <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
            When it ships, a key will be shown once at creation and never
            again. Store it somewhere you can read it back.
          </p>
        </Card>
      </div>
    </PageShell>
  );
}
