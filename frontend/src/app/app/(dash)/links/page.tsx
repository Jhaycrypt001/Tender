import { PageHeader, PageShell, SectionHeader } from "@/components/dash/shell";
import { Card } from "@/components/dash/card";
import { Empty, ErrorState } from "@/components/dash/empty";
import { LinkIcon } from "@/components/dash/icons";
import { CopyValue } from "@/components/dash/copy";
import { Timestamp } from "@/components/dash/money";
import { FiatMoney } from "@/components/dash/currency";
import { listLinks } from "@/lib/api/links";
import { APP_URL } from "@/lib/auth";
import { LinkForm } from "./form";
import { LinkTools } from "./tools";

export const metadata = { title: "Payment links · Tender" };

export const dynamic = "force-dynamic";

/** How many links to show. Links are few by nature — these are not invoices. */
const LIMIT = 50;

/**
 * Reusable payment links.
 *
 * ⚠️ Every share URL is built from `token`, never `id` — the same rule the
 * invoice page follows. The id is enumerable and merchant-private; putting it
 * in a URL that gets pasted into a group chat would hand a stranger a walk
 * through the merchant's links.
 */
export default async function LinksPage() {
  const result = await listLinks({ limit: LIMIT });

  return (
    <PageShell>
      <PageHeader
        back="/app/home"
        eyebrow="Payment links"
        title="One link, every buyer."
        description="One link you can reuse. Every buyer who opens it gets their own invoice."
      />

      <LinkForm />

      <div className="mt-7">
        <SectionHeader label="Your links" />

        {!result.ok ? (
          <ErrorState error={result.error} />
        ) : result.data.data.length === 0 ? (
          <Empty
            icon={<LinkIcon className="h-5 w-5" />}
            title="No links yet"
            description="Create one above. A link is worth making when you get paid the same amount more than once — a retainer, a class, a standard service."
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {result.data.data.map((link) => {
              const url = `${APP_URL}/pay/${link.token}`;
              return (
                <li key={link.id}>
                  <Card tone="quiet">
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="text-[0.9375rem]">{link.label}</span>
                        <span className="text-[0.9375rem]">
                          {/* A null amount is the open-amount link. Rendering
                              "0.00" here would be a lie about what the buyer
                              is asked for. */}
                          {link.amount ? (
                            <FiatMoney
                              amount={link.amount}
                              currency={link.currency}
                            />
                          ) : (
                            <span className="text-mute">Buyer chooses</span>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-paper px-3 py-2">
                        <code className="min-w-0 break-all font-mono text-[0.75rem]">
                          {url}
                        </code>
                        <CopyValue value={url} label="Copy link" />
                      </div>

                      {/* A paused link would put a dead code on a counter. */}
                      {link.active && <LinkTools url={url} label={link.label} />}

                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5 text-[0.8125rem] text-mute">
                        <span>
                          {/* `uses` is a count of invoices produced, not of
                              payments received. Those differ whenever a buyer
                              opens a link and does not pay. */}
                          {link.uses === 1
                            ? "1 invoice created"
                            : `${link.uses} invoices created`}
                          {!link.active && " · paused"}
                        </span>
                        <span>
                          Created <Timestamp value={link.created_at} />
                        </span>
                      </div>
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </PageShell>
  );
}
