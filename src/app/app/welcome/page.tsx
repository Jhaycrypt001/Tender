import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import Welcome from "./welcome";

export const metadata: Metadata = {
  title: "Welcome · Tender",
};

/**
 * Server half: guards the route. Reaching the transition without a valid
 * session sends you back to sign-in, so the animation can never play for
 * someone who is not actually signed in.
 */
export default async function WelcomePage() {
  const jar = await cookies();
  const session = decodeSession(jar.get(SESSION_COOKIE)?.value);

  if (!session) redirect("/app");

  return <Welcome name={session.name} />;
}
