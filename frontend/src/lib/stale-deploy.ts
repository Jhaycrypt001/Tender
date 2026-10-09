/**
 * Recovering a tab that is still running the PREVIOUS deployment.
 *
 * Every push ships new server-action ids and new JS chunks. A tab opened before the push still
 * calls the old ids, and the new server answers "Failed to find Server Action … older or newer
 * deployment"; it may also ask for a chunk that no longer exists. Either way the screen shows an
 * error that only a reload cures, and users were clearing cookies to get that reload.
 *
 * So: on exactly those errors, reload once. Guarded so a genuine fault that happens to match can
 * never trap the page in a reload loop: at most one automatic reload per 30 seconds.
 */
const STALE = /failed to find server action|older or newer deployment|server action .*not found|ChunkLoadError|loading (css )?chunk .* failed/i;
const LAST_RELOAD = "tender:stale-reload-at";

export function isStaleDeploy(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return STALE.test(text);
}

/** Reloads the page if `error` means this tab is out of date. True if a reload was started. */
export function reloadIfStale(error: unknown): boolean {
  if (typeof window === "undefined" || !isStaleDeploy(error)) return false;
  try {
    const last = Number(window.sessionStorage.getItem(LAST_RELOAD) ?? 0);
    if (Date.now() - last < 30_000) return false;
    window.sessionStorage.setItem(LAST_RELOAD, String(Date.now()));
  } catch {
    // No storage (private mode): still reload. The pattern only matches deploy skew.
  }
  window.location.reload();
  return true;
}
