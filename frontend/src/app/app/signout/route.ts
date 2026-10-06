import { NextResponse } from "next/server";
import { APP_URL, SESSION_COOKIE } from "@/lib/auth";

function signOut() {
  const response = NextResponse.redirect(new URL("/app", APP_URL), {
    // 303 so the browser follows with a GET. A bare redirect after a POST
    // defaults to 307, which replays the POST against /app.
    status: 303,
  });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/**
 * Signing out is a state change, so it is POST only: a GET that mutates can be
 * triggered by anything that prefetches, scans, or embeds a link (an image tag on
 * another site could sign a merchant out). The dashboard menu submits a form.
 */
export async function POST() {
  return signOut();
}
