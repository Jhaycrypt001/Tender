import type { ZodType } from "zod";
import { QuoteResponse, StatusResponse, TokenList, type QuoteRequest, type Token } from "./types.js";

/**
 * The ONLY place that talks to NEAR Intents' 1Click API directly. Everything else in Tender that moves money
 * across chains goes through Aurora (src/aurora/); this is the separate, direct path.
 *
 * What it moves: nothing. 1Click quotes, hands out a one-off deposit address and reports status. Money only
 * moves when the merchant's own wallet signs a transfer to that address.
 */

export type NearIntentsLogger = { debug: (o: object, m: string) => void; info: (o: object, m: string) => void; warn: (o: object, m: string) => void };

export type NearIntentsOptions = {
  baseUrl?: string;
  /** Optional. Without a key 1Click charges its unauthenticated fee schedule. Sent as X-API-Key, never logged. */
  apiKey?: string;
  logger?: NearIntentsLogger;
  timeoutMs?: number;
  maxAttempts?: number;
  fetch?: typeof fetch;
};

export type NearIntentsErrorKind = "bad_request" | "auth" | "rate_limit" | "not_found" | "upstream" | "network";

export class NearIntentsError extends Error {
  constructor(
    public readonly kind: NearIntentsErrorKind,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "NearIntentsError";
  }
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class NearIntentsClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: NearIntentsLogger;

  constructor(private readonly opts: NearIntentsOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://1click.chaindefuser.com").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.fetchImpl = opts.fetch ?? fetch;
    this.logger = opts.logger ?? { debug() {}, info() {}, warn() {} };
  }

  /** Every asset 1Click can route, on every chain it supports. */
  async tokens(): Promise<Token[]> {
    return this.request("GET /v0/tokens", TokenList, { method: "GET", path: "/v0/tokens" });
  }

  /**
   * A quote. `dry: true` only simulates; without it, the response carries the one-off `depositAddress` that, once
   * funded from the origin chain, makes 1Click deliver to `recipient`. Creating one moves no money.
   */
  async quote(req: QuoteRequest): Promise<QuoteResponse> {
    const started = Date.now();
    const res = await this.request("POST /v0/quote", QuoteResponse, {
      method: "POST",
      path: "/v0/quote",
      body: { swapType: "EXACT_INPUT", slippageTolerance: 100, depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", ...req },
    });
    if (!req.dry) {
      if (!res.quote.depositAddress) throw new NearIntentsError("upstream", "NEAR Intents returned a quote without a deposit address");
      // Everything needed to trace this payout later, and to dispute it: the id, the signature and where it goes.
      this.logger.info(
        {
          depositAddress: res.quote.depositAddress,
          recipient: req.recipient,
          originAsset: req.originAsset,
          destinationAsset: req.destinationAsset,
          amountIn: res.quote.amountIn,
          amountOut: res.quote.amountOut,
          correlationId: res.correlationId,
          signature: res.signature,
          ms: Date.now() - started,
        },
        "near intents deposit address made",
      );
    }
    return res;
  }

  /** Where a swap is. null when 1Click does not know the deposit address (yet). */
  async status(depositAddress: string): Promise<{ state: string; deliveredTx: string | null } | null> {
    try {
      const res = await this.request("GET /v0/status", StatusResponse, { method: "GET", path: `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}` });
      return { state: res.status, deliveredTx: res.swapDetails?.destinationChainTxHashes?.[0]?.hash ?? null };
    } catch (err) {
      if (err instanceof NearIntentsError && err.kind === "not_found") return null;
      throw err;
    }
  }

  private async request<T>(route: string, schema: ZodType<T>, spec: { method: "GET" | "POST"; path: string; body?: unknown }): Promise<T> {
    let last: NearIntentsError | undefined;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const started = Date.now();
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${spec.path}`, {
          method: spec.method,
          headers: { "content-type": "application/json", ...(this.opts.apiKey ? { "x-api-key": this.opts.apiKey } : {}) },
          body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok) {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            throw new NearIntentsError("upstream", `${route}: the reply is not JSON`, res.status);
          }
          const parsed = schema.safeParse(json);
          if (!parsed.success) throw new NearIntentsError("upstream", `${route}: unexpected reply (${parsed.error.issues[0]?.path.join(".") || "shape"})`, res.status);
          return parsed.data;
        }
        const message = readMessage(text) ?? `${res.status}`;
        const kind: NearIntentsErrorKind =
          res.status === 404 ? "not_found" : res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate_limit" : res.status >= 500 || res.status === 408 ? "upstream" : "bad_request";
        throw new NearIntentsError(kind, message, res.status);
      } catch (err) {
        last = err instanceof NearIntentsError ? err : new NearIntentsError("network", `${route}: ${err instanceof Error ? err.message : String(err)}`);
        const retry = last.kind === "network" || (last.status !== undefined && RETRY_STATUSES.has(last.status));
        this.logger.warn({ route, attempt, kind: last.kind, status: last.status, err: last.message.slice(0, 200), ms: Date.now() - started }, "near intents request failed");
        if (!retry || attempt === this.maxAttempts) break;
        await new Promise((r) => setTimeout(r, 200 * attempt));
      }
    }
    throw last!;
  }
}

/** 1Click answers refusals as `{ message: "..." }`. */
function readMessage(text: string): string | null {
  try {
    const m = (JSON.parse(text) as { message?: unknown }).message;
    return typeof m === "string" ? m.slice(0, 300) : null;
  } catch {
    return null;
  }
}
