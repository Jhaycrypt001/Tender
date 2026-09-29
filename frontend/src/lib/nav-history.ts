/**
 * The dashboard's own record of where the merchant has been this visit.
 *
 * Why not just `router.back()`: the browser's history also holds whatever
 * came BEFORE the dashboard — the Google sign-in hop, a search result, an
 * email link. A back button that blindly steps the browser back would, on a
 * deep link, throw the merchant out of the app entirely. So the button only
 * steps back through history it saw being made here, and otherwise goes to
 * the screen's logical parent.
 *
 * Module state, not React state: it has to outlive every page component and
 * be readable at click time, and it is intentionally lost on a full reload —
 * after a reload the browser history is no longer one this code can vouch for.
 */

const trail: string[] = [];

/** Called by the dashboard header on every pathname change, first mount included. */
export function recordPath(pathname: string) {
  if (trail[trail.length - 1] === pathname) return;
  // Arriving at the entry just below the top is a Back (browser button, swipe,
  // or this component) — pop rather than push, or the trail would grow on
  // every round trip and the button would never fall back to the parent.
  if (trail[trail.length - 2] === pathname) {
    trail.pop();
    return;
  }
  trail.push(pathname);
}

/** True when there is a page behind this one that was visited inside the app. */
export function canGoBack() {
  return trail.length > 1;
}
