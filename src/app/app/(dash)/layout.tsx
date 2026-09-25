import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import DashNav from "@/components/dash/nav";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";

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

  if (!session) redirect("/app");

  return (
    <div className="flex min-h-dvh flex-col bg-stone">
      <DashNav
        session={{
          name: session.name,
          email: session.email,
          picture: session.picture,
        }}
      />
      <main className="flex-1">{children}</main>
    </div>
  );
}
