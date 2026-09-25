/**
 * The checkout owns the whole viewport.
 *
 * The marketing header and footer are rendered by the root layout around every
 * page. On a payment screen they are worse than clutter: a "Get started" button
 * beside someone's payment address invites them to leave mid-transaction, and
 * the footer's link columns give a stranger a dozen ways to wander off before
 * they have paid.
 *
 * ⚠️ The rules that hide them live in `globals.css`, NOT in a <style> tag here.
 * React 19 does not server-render a <style> without `href`/`precedence`; it
 * inserts it at hydration, so the chrome painted first and then disappeared.
 * This element only supplies the `.tender-pay-chrome` hook the stylesheet
 * matches on. Same body-scoped technique as /app rather than a route group, so
 * the marketing pages stay where they are.
 */
export default function PayLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="tender-pay-chrome min-h-dvh bg-stone">{children}</div>
  );
}
