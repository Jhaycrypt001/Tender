/**
 * The /app routes are the product, not the marketing site, so they drop the
 * site nav and footer. The root layout renders those around `children`, so
 * this layout hides them with a body-scoped class rather than restructuring
 * the root — which would mean moving every marketing page into a route group.
 *
 * ⚠️ The rules live in `globals.css`, NOT in a <style> tag here: React 19
 * defers an unkeyed <style> to hydration, which made the chrome flash before
 * it was hidden. This element only supplies the `.tender-app-chrome` hook.
 *
 * It also mounts the sign-in provider (Privy) for every /app screen: the
 * sign-in page, the welcome step that sets up the wallet, and sign-out, which
 * has to end the Privy session as well as ours.
 */
import AuthProvider from "@/components/auth/privy-provider";
import { PRIVY_APP_ID } from "@/lib/auth";
import type { Metadata } from "next";

// Everything under /app is a signed-in screen: keep it out of search results.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="tender-app-chrome">
      <AuthProvider appId={PRIVY_APP_ID}>{children}</AuthProvider>
    </div>
  );
}
