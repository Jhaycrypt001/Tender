import Link from "next/link";
import { PageHeader, PageShell } from "@/components/dash/shell";
import { Card, CardHeader } from "@/components/dash/card";

export const metadata = { title: "Pay · Tender" };

/**
 * Outbound money — the hub.
 *
 * Three routes, and only one of them is live. Rather than present three
 * identical tiles and let the merchant discover which two dead-end, each
 * carries its real state: refund is a link, the other two say plainly that
 * they are not built. The nav already lists all three, so hiding the unbuilt
 * ones here would only move the dead end rather than remove it.
 */

type Route = {
  href: string;
  label: string;
  desc: string;
  /** Null when the route is live; otherwise why it is not. */
  blocked: string | null;
};

const ROUTES: Route[] = [
  {
    href: "/app/pay/refund",
    label: "Refund",
    desc: "Return a settled payment to the buyer who made it. Full amount, back the way it came.",
    blocked: null,
  },
  {
    href: "/app/pay/payout",
    label: "Payout",
    desc: "Send settled revenue to a supplier, a contractor or your own wallet.",
    blocked: "Needs an API endpoint that does not exist yet",
  },
  {
    href: "/app/pay/split",
    label: "Split",
    desc: "Divide one amount across several addresses in a single flow.",
    blocked: "Needs an API endpoint that does not exist yet",
  },
];

export default function PayPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Outbound"
        title="Pay"
        description="Money going back out: refunds to buyers, payouts to suppliers, splits across a team."
      />

      <div className="grid gap-4 md:grid-cols-3">
        {ROUTES.map((r) =>
          r.blocked ? (
            <Card key={r.href} tone="quiet">
              <CardHeader label={r.label} />
              <p className="text-[0.875rem] leading-relaxed text-mute">
                {r.desc}
              </p>
              <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] leading-relaxed text-mute">
                <span aria-hidden="true" className="mr-1.5 text-sand">
                  &#9632;
                </span>
                {r.blocked}.
              </p>
            </Card>
          ) : (
            <Link
              key={r.href}
              href={r.href}
              className="group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2"
            >
              <Card className="h-full transition-colors group-hover:border-mute/50">
                <CardHeader label={r.label} />
                <p className="text-[0.875rem] leading-relaxed text-mute">
                  {r.desc}
                </p>
                <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-ink">
                  Open
                  <span aria-hidden="true" className="ml-1.5 text-sand">
                    &rarr;
                  </span>
                </p>
              </Card>
            </Link>
          ),
        )}
      </div>
    </PageShell>
  );
}
