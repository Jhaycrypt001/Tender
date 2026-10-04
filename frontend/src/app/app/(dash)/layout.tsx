import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashNav from "@/components/dash/nav";
import { AskProvider } from "@/components/ask/ask-provider";
import { FrameMark } from "@/components/dash/shell";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import { accountsEnabled } from "@/lib/api/server";

/**
 * The signed-in dashboard.
 *
 * ⭐ This layout is the auth boundary for every route in the `(dash)` group.
 * The check runs on the server before any child renders, so a signed-out
 * visitor is redirected without a flash of dashboard chrome — which is exactly
 * what a client-side guard cannot promise.
 *
 * `(dash)` is a route group: it adds no URL segment, so this file wraps
 * `/app/home`, `/app/activity` and the rest while sign-in stays at `/app`,
 * outside the group and therefore outside the guard.
 *
 * Note it nests inside `src/app/app/layout.tsx`, which already hides the
 * marketing nav and footer. This adds the dashboard's own chrome on top; it
 * does not replace that.
 */

// The session lives in a cookie, so nothing here can be statically rendered.
export const dynamic = "force-dynamic";

export default async function DashLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);

  // No session, or one from before accounts were linked (no merchant id): back
  // to sign-in. Every API call acts for `session.merchantId`, so a session
  // without one would only show "not linked" errors on every screen.
  if (!session || (accountsEnabled() && !session.merchantId)) redirect("/app");

  // The Ask assistant opens over whichever screen is showing, so it wraps the
  // whole chrome rather than living on one route.
  return (
    <AskProvider firstName={session.name.trim().split(/\s+/)[0] ?? ""}>
      <div className="flex min-h-dvh flex-col bg-stone">
        <DashNav
          session={{
            name: session.name,
            email: session.email,
            picture: session.picture,
          }}
        />
        {/* The frame: two hairline rails bounding the content column, marked
            with a + where they meet the header rule. It is what makes every
            screen read as one sheet of the same document rather than a page
            floating on grey. Rails only from md — on a phone the column is the
            screen, and two lines 16px in would just eat width. */}
        <div className="relative mx-auto flex w-full max-w-[76rem] flex-1 flex-col md:border-x md:border-line">
          <FrameMark className="left-0 top-0 -translate-x-1/2 -translate-y-1/2" />
          <FrameMark className="right-0 top-0 translate-x-1/2 -translate-y-1/2" />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </AskProvider>
  );
}
