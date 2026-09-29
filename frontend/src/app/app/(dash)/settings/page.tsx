import Link from "next/link";
import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";
import { ErrorState } from "@/components/dash/empty";
import { ReadOnlyField } from "@/components/dash/field";
import { Timestamp } from "@/components/dash/money";
import { getMerchant } from "@/lib/api/merchant";
import { SettlementPanel } from "./settlement";

export const metadata = { title: "Settings · Tender" };

export const dynamic = "force-dynamic";

/**
 * Account settings.
 *
 * The page is ordered by consequence, not by convention: settlement is at the
 * top because it is the only setting on it that can lose the merchant money.
 * Profile — name, email, when they joined — is below it, read-only, because
 * those come from the Google account they signed in with and this screen is
 * not where an identity provider gets edited.
 */
export default async function SettingsPage() {
  const result = await getMerchant();

  if (!result.ok) {
    return (
      <PageShell>
        <PageHeader
          eyebrow="Settings"
          title="Where the money goes."
          description="Where money settles, and who this account belongs to."
        />
        <ErrorState error={result.error} />
      </PageShell>
    );
  }

  const m = result.data;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Settings"
        title="Where the money goes."
        description="Where money settles, and who this account belongs to."
        actions={
          <Link
            href="/app/settings/developers"
            className="text-[0.875rem] text-mute underline-offset-4 hover:text-ink hover:underline"
          >
            Developers
          </Link>
        }
      />

      <SettlementPanel
        address={m.settlement_address ?? ""}
        asset={m.settlement_asset ?? ""}
        verified={m.settlement_verified}
      />

      <div className="mt-7">
        <SectionHeader label="Account" />
        <div className="grid gap-4 lg:grid-cols-2">
          <Card tone="quiet">
            <CardHeader
              label="Profile"
              hint="From the Google account you signed in with."
            />
            <div className="flex flex-col gap-5">
              <ReadOnlyField label="Name">{m.name}</ReadOnlyField>
              <ReadOnlyField label="Email">{m.email}</ReadOnlyField>
              <ReadOnlyField label="Joined">
                <Timestamp value={m.created_at} />
              </ReadOnlyField>
            </div>
          </Card>

          <Card tone="quiet">
            <CardHeader
              label="Pricing"
              hint="What Tender takes from each settled payment."
            />
            <div className="flex flex-col gap-5">
              {/* fee_bps is basis points. 40 is 0.40%, not 40%. Rendering the
                  raw number here would be a hundredfold overstatement of our
                  own fee on the screen a merchant checks it on. */}
              <ReadOnlyField label="Tender fee">
                {(m.fee_bps / 100).toFixed(2)}%
              </ReadOnlyField>
              <ReadOnlyField label="Merchant ID">
                <code className="font-mono text-[0.8125rem]">{m.id}</code>
              </ReadOnlyField>
            </div>
            <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
              Taken from the settled amount. Buyers are never charged it on top
              of what you asked for.
            </p>
          </Card>
        </div>
      </div>
    </PageShell>
  );
}
