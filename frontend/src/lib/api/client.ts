import type { ApiError, ApiErrorKind, ApiResult } from "./types";

/**
 * The one place the frontend talks to the Tender API.
 *
 * Everything in `src/lib/api/` funnels through `request()`. When a path moves
 * or an auth header changes, exactly one file changes.
 *
 * ⚠️ SECURITY — WHY THE MERCHANT HALF LIVES IN `./server`.
 *
 * Merchant routes authenticate with `Authorization: Bearer <TENDER_PLATFORM_KEY>`
 * plus `X-Tender-Merchant: <merchant id>`. The platform key can act as ANY
 * merchant. If it ever reaches the browser, anyone who opens devtools on the
 * dashboard can read it out of the JS bundle and act as every merchant at once.
 *
 * So this file holds only what is safe in the browser: the shared transport and
 * `publicRequest()`. The authenticated `request()` is in `./server`, which reads
 * the signed session cookie and so can only run on the server. The rule is:
 *
 *   - Merchant reads  → server components, calling `request()` from `./server`.
 *   - Merchant writes → server actions and route handlers, which attach the
 *                       key server-side and proxy onward.
 *   - The browser only ever talks to our own origin, never to the API with a key.
 *
 * `publicRequest()` is the sole exception: the buyer checkout is unauthenticated
 * by design and safe to call from the browser.
 */

/** Public base URL. Safe in the browser: the public routes carry no auth. */
const PUBLIC_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * Server-side base. Not NEXT_PUBLIC_ prefixed, so Next leaves it undefined in
 * the browser bundle. The platform key is read in `./server`, never here.
 */
export const SERVER_BASE = process.env.TENDER_API_URL ?? PUBLIC_BASE;

/**
 * How a merchant call authenticates: the platform key, and which merchant it
 * acts for. `merchantId` is omitted only for the `/internal/*` routes, which
 * act for no merchant (finding the merchant for a sign-in is one of them).
 */
export type MerchantAuth = { key: string; merchantId?: string };

/** How long to wait before giving up on a request. */
const TIMEOUT_MS = 15_000;

function err(kind: ApiErrorKind, message: string, status?: number): ApiError {
  return { kind, message, status };
}

/**
 * Maps an HTTP status onto the error kinds the UI distinguishes.
 * 4xx that we do not name specifically is a validation problem far more often
 * than anything else, so it falls there rather than into `unknown`.
 */
function kindForStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  if (status >= 400) return "validation";
  return "unknown";
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Idempotency-Key header. Set it on every create that a user could retry. */
  idempotencyKey?: string;
  /** Query parameters. Undefined and null values are dropped, not serialised. */
  query?: Record<string, string | number | undefined | null>;
  /**
   * Payment state changes constantly, so dashboard reads must never be served
   * from a cache. Set a revalidate window only for genuinely static reads
   * (the chain list, for instance).
   */
  revalidate?: number;
};

function buildUrl(
  base: string,
  path: string,
  query?: RequestOptions["query"],
): string {
  const url = `${base.replace(/\/$/, "")}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * The transport. `auth` is null for public routes. Exported for `./server`
 * only; call `request()` or `publicRequest()` instead.
 */
export async function send<T>(
  base: string,
  path: string,
  options: RequestOptions,
  auth: MerchantAuth | null,
): Promise<ApiResult<T>> {
  /**
   * The normal state today. The backend is not deployed yet, so rather than
   * firing a request at "" and surfacing a confusing network error, we return
   * a named result that screens render as their empty state.
   */
  if (!base) {
    return {
      ok: false,
      error: err(
        "not_configured",
        "The Tender API is not connected yet. Set NEXT_PUBLIC_API_URL to point at it.",
      ),
    };
  }

  if (auth && !auth.key) {
    return {
      ok: false,
      error: err(
        "not_configured",
        "No platform key configured. Set TENDER_PLATFORM_KEY on the server.",
      ),
    };
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) headers["Authorization"] = `Bearer ${auth.key}`;
  if (auth?.merchantId) headers["X-Tender-Merchant"] = auth.merchantId;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  // AbortSignal.timeout would be terser, but an explicit controller lets us
  // clear the timer on success so it does not keep the process alive.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(base, path, options.query), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      cache: options.revalidate === undefined ? "no-store" : undefined,
      next: options.revalidate === undefined ? undefined : { revalidate: options.revalidate },
    });

    if (!response.ok) {
      // An error body is a courtesy, not a guarantee: a proxy or gateway can
      // return HTML, so parsing is best-effort and never throws past here.
      let message = `Request failed with ${response.status}.`;
      let fields: Record<string, string> | undefined;
      try {
        const parsed = await response.json();
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.message === "string") message = parsed.message;
          else if (typeof parsed.error === "string") message = parsed.error;
          if (parsed.fields && typeof parsed.fields === "object") fields = parsed.fields;
        }
      } catch {
        // Keep the status-derived message.
      }
      return {
        ok: false,
        error: { ...err(kindForStatus(response.status), message, response.status), fields },
      };
    }

    // 204 and other empty bodies are legitimate successes (cancel, for one).
    if (response.status === 204) return { ok: true, data: undefined as T };

    const text = await response.text();
    if (!text) return { ok: true, data: undefined as T };

    return { ok: true, data: JSON.parse(text) as T };
  } catch (cause) {
    const aborted = cause instanceof Error && cause.name === "AbortError";
    return {
      ok: false,
      error: err(
        "network",
        aborted
          ? "The API did not respond in time."
          : "Could not reach the Tender API.",
      ),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Unauthenticated call against a `/public/*` route.
 * Safe in the browser — this is what the buyer checkout uses.
 */
export function publicRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResult<T>> {
  return send<T>(PUBLIC_BASE, path, options, null);
}

/** The public API base, for building an SSE URL. Empty when unconfigured. */
export function publicBase(): string {
  return PUBLIC_BASE.replace(/\/$/, "");
}

/**
 * True when the API is wired up at all.
 *
 * Screens use this to tell two very different empty states apart: "the backend
 * is not connected yet" and "the backend answered, and you genuinely have no
 * invoices". Both render calmly; they should not read the same.
 */
export function isApiConfigured(): boolean {
  return Boolean(PUBLIC_BASE || SERVER_BASE);
}
