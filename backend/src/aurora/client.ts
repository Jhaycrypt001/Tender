import { z } from "zod";
import type { Logger } from "../lib/logger.js";
import { auroraRequests } from "../lib/metrics.js";
import {
  DepositStatusResponse,
  MintResponse,
  QuoteResponse,
  TokensResponse,
  type Deposit,
  type DepositListType,
  type Token,
} from "./types.js";

/**
 * The only code in the backend that talks to Aurora (BACKEND.md rule 4).
 *
 * - Every request has a timeout.
 * - 429, 5xx and network failures retry with exponential backoff and jitter.
 * - Every response is parsed with zod before anything else sees it.
 * - Failures surface as one error type, `AuroraError`, with a `kind` callers
 *   branch on — never a raw fetch error or an upstream body.
 * - The API key sits in Aurora's URL path, so URLs are never logged: log
 *   lines carry the route template instead.
 */

export type AuroraErrorKind =
  | "rate_limited"
  | "upstream"
  | "bad_request"
  | "not_found"
  | "network"
  | "invalid_response";

export class AuroraError extends Error {
  constructor(
    readonly kind: AuroraErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AuroraError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "upstream" || this.kind === "network";
  }
}

export type AuroraClientOptions = {
  baseUrl: string;
  apiKey: string;
  logger: Logger;
  timeoutMs?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
};

export type RouteQuote =
  | { ok: true; /** What the recipient would get, already in whole units ("0.997197"). */ amountOut: string | null; seconds: number | null }
  | { ok: false; reason: "below_minimum"; /** The smallest amount Aurora will take, in the origin token's base units. */ minimumBaseUnits: string | null }
  | { ok: false; reason: "invalid_recipient" | "no_trustline" | "unavailable" };

export type MintInput = {
  /** Merchant's settlement address on the destination chain. */
  recipient: string;
  /** Our identifier for the payer: the invoice id (constraint #6). */
  sender: string;
  depositChain: string;
  destinationChain: string;
  destinationAsset: string;
};

type RequestSpec = { method: "GET" | "POST"; path: string; body?: unknown; timeoutMs?: number };

/**
 * Minting a NEW address makes Aurora fetch an upstream quote first, and during
 * Aurora's slow spells (seen several times live) that alone can pass 10s.
 * Invoice creation waits on it, so it gets a longer budget than reads.
 */
const MINT_TIMEOUT_MS = 30_000;

export class AuroraClient {
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: AuroraClientOptions) {
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Mint a deposit address. Idempotent on its inputs: same inputs, same address. */
  mintAddress(input: MintInput): Promise<MintResponse> {
    return this.request("POST /api/persistent-deposit-address", MintResponse, {
      method: "POST",
      path: `/api/persistent-deposit-address/${this.key}`,
      body: input,
      timeoutMs: Math.max(this.timeoutMs, MINT_TIMEOUT_MS),
    });
  }

  /**
   * One of the three deposit lists for an address. Aurora paginates `received`
   * only; an invoice address holds a handful of deposits so one page is the whole
   * list, but a standing address grows without bound, so it passes `page`.
   */
  async deposits(address: string, type: DepositListType, page?: { limit: number; offset: number }): Promise<Deposit[]> {
    const qs = new URLSearchParams({ type, address });
    if (page) {
      qs.set("limit", String(page.limit));
      qs.set("offset", String(page.offset));
    }
    const res = await this.request("GET /api/persistent-deposit-status", DepositStatusResponse, {
      method: "GET",
      path: `/api/persistent-deposit-status/${this.key}?${qs}`,
    });
    return res.deposits;
  }

  async tokens(): Promise<Token[]> {
    const res = await this.request("GET /api/tokens", TokensResponse, {
      method: "GET",
      path: `/api/tokens/${this.key}`,
    });
    return res.tokens;
  }

  /**
   * A DRY quote: validates a swap and prices it without creating anything.
   * Aurora refuses amounts below the route's minimum, which is how we measure
   * per-chain minimums.
   *
   * `refundTo` must be an address on the ORIGIN chain: a sub-minimum deposit
   * is refunded there, and that refund's fee is part of the real minimum. An
   * Intents-account refund skips it and under-measures (seen live: Bitcoin
   * read ~20% low).
   */
  async dryQuote(input: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    recipient: string;
    refundTo: string;
  }): Promise<QuoteResponse | null> {
    try {
      return await this.request("POST /api/quote", QuoteResponse, {
        method: "POST",
        path: `/api/quote/${this.key}`,
        body: {
          dry: true,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          depositType: "ORIGIN_CHAIN",
          recipientType: "DESTINATION_CHAIN",
          refundType: "ORIGIN_CHAIN",
          deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
          ...input,
        },
      });
    } catch (err) {
      // "Failed to get quote" is how Aurora says the amount is too small.
      if (err instanceof AuroraError && err.kind === "bad_request") return null;
      throw err;
    }
  }

  /**
   * A dry quote for a payout leaving Monad, with the refusal explained. Unlike `dryQuote`
   * (which reads "refused" as "below the minimum"), a payout has to tell the merchant WHY:
   * a mistyped address, an amount too small to cover the fee, a Stellar-style account that
   * cannot hold the asset, or a route that is simply down.
   */
  async routeQuote(input: {
    originAsset: string;
    destinationAsset: string;
    amount: string;
    recipient: string;
    refundTo: string;
  }): Promise<RouteQuote> {
    try {
      const res = await this.request("POST /api/quote", QuoteResponse, {
        method: "POST",
        path: `/api/quote/${this.key}`,
        body: {
          dry: true,
          swapType: "EXACT_INPUT",
          slippageTolerance: 100,
          depositType: "ORIGIN_CHAIN",
          recipientType: "DESTINATION_CHAIN",
          refundType: "ORIGIN_CHAIN",
          deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
          ...input,
        },
      });
      return { ok: true, amountOut: res.quote.amountOutFormatted ?? null, seconds: res.quote.timeEstimate ?? null };
    } catch (err) {
      if (!(err instanceof AuroraError)) throw err;
      // Aurora answers 400 for every refusal and signals the cause only in the text.
      if (err.kind === "bad_request" || (err.kind === "upstream" && /internal server error/i.test(err.message))) {
        const text = err.message;
        if (/too low|minimum/i.test(text)) {
          const atLeast = /at least (\d+)/i.exec(text);
          return { ok: false, reason: "below_minimum", minimumBaseUnits: atLeast ? atLeast[1]! : null };
        }
        if (/recipient is not valid|invalid recipient|not a valid/i.test(text)) return { ok: false, reason: "invalid_recipient" };
        if (/trustline/i.test(text)) return { ok: false, reason: "no_trustline" };
        return { ok: false, reason: "unavailable" };
      }
      throw err;
    }
  }

  /** Tells Aurora about a buyer-supplied tx hash, to speed up detection. */
  async submitDeposit(txHash: string, depositAddress: string): Promise<void> {
    await this.request("POST /api/deposit/submit", z.unknown(), {
      method: "POST",
      path: `/api/deposit/submit/${this.key}`,
      body: { txHash, depositAddress },
    });
  }

  private get key(): string {
    return encodeURIComponent(this.opts.apiKey);
  }

  private async request<T>(route: string, schema: z.ZodType<T>, req: RequestSpec): Promise<T> {
    let lastError: AuroraError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const timer = auroraRequests.startTimer({ route });
      try {
        const result = await this.attempt(route, schema, req, attempt);
        timer({ outcome: "ok" });
        return result;
      } catch (err) {
        const error =
          err instanceof AuroraError ? err : new AuroraError("network", `${route}: ${(err as Error).message}`);
        timer({ outcome: error.kind });
        if (!error.retryable) {
          // A refused quote is routine (it is how minimums are measured), but a
          // 401/403 is a key or plan problem that no retry fixes: say so plainly,
          // or the merchant only ever sees a generic "retry" 502.
          if (error.status === 401 || error.status === 403) {
            this.opts.logger.error({ route, status: error.status, message: error.message }, "aurora rejected the API key: check its permissions");
          }
          throw error;
        }
        lastError = error;
        this.opts.logger.warn({ route, attempt, kind: error.kind, status: error.status }, "aurora request failed");
      }
      if (attempt < this.maxAttempts) await sleep(backoffMs(attempt));
    }

    throw lastError ?? new AuroraError("network", `${route}: failed`);
  }

  private async attempt<T>(route: string, schema: z.ZodType<T>, req: RequestSpec, attempt: number): Promise<T> {
    const started = Date.now();
    const res = await this.fetchImpl(this.opts.baseUrl + req.path, {
      method: req.method,
      headers: req.body ? { "content-type": "application/json" } : undefined,
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal: AbortSignal.timeout(req.timeoutMs ?? this.timeoutMs),
    });

    if (!res.ok) {
      const message = await upstreamMessage(res);
      throw new AuroraError(kindForStatus(res.status), `${route} → ${res.status}: ${message}`, res.status);
    }

    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) {
      throw new AuroraError("invalid_response", `${route}: unexpected response shape: ${parsed.error.message}`);
    }
    this.opts.logger.debug({ route, attempt, ms: Date.now() - started }, "aurora request ok");
    return parsed.data;
  }
}

function kindForStatus(status: number): AuroraErrorKind {
  if (status === 429) return "rate_limited";
  if (status === 404) return "not_found";
  if (status >= 500) return "upstream";
  return "bad_request";
}

/** Aurora errors carry `{ message }`. Truncated so a huge body never floods a log. */
async function upstreamMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    return typeof body.message === "string" ? body.message.slice(0, 300) : res.statusText;
  } catch {
    return res.statusText;
  }
}

/** 250ms, 500ms, 1s, … capped at 5s, with ±25% jitter. */
export function backoffMs(attempt: number): number {
  const base = Math.min(250 * 2 ** (attempt - 1), 5000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
