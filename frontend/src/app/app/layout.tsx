/**
 * The /app routes are the product, not the marketing site, so they drop the
 * site nav and footer. The root layout renders those around `children`, so
 * this layout hides them with a body-scoped class rather than restructuring
 * the root — which would mean moving every marketing page into a route group.
 *
 * ⚠️ The rules live in `globals.css`, NOT in a <style> tag here: React 19
 * defers an unkeyed <style> to hydration, which made the chrome flash before
 * it was hidden. This element only supplies the `.tender-app-chrome` hook.
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <div className="tender-app-chrome">{children}</div>;
}
