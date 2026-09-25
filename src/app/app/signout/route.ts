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
 * Signing out is a state change, so the dashboard menu submits a form rather
 * than following a link — a GET that mutates can be triggered by anything that
 * prefetches or scans links. GET is kept for any plain anchor still pointing
 * here, but POST is the path the app uses.
 */
export async function POST() {
  return signOut();
}

export async function GET() {
  return signOut();
}
