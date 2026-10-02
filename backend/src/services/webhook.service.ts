import { isIP } from "node:net";
import type { Dispatcher } from "undici";
import { fetch as undiciFetch } from "undici";
import { signWebhook, signWebhookV2 } from "../lib/crypto.js";
import { isPublicAddress, publicOnlyDispatcher } from "../lib/safe-http.js";

/**
 * Sends one signed webhook. Pure transport: retries and bookkeeping live in
 * the delivery worker.
 *
 * Headers:
 *   X-Tender-Signature     sha256=<hmac of the raw body>   v1, the scheme published at /docs
 *   X-Tender-Signature-V2  sha256=<hmac of "<timestamp>.<raw body>">   v2, covers the timestamp
 *   X-Tender-Timestamp     unix seconds of THIS attempt
 *   X-Tender-Event-Id      the event id, for at-least-once dedupe
 *
 * v1 signs the body only, so the timestamp header is not covered by it: it can
 * be altered or replayed. v2 signs `timestamp.body`, so it cannot, and a
 * captured request stops verifying after `WEBHOOK_TOLERANCE_SECONDS`. Both are
 * sent on every attempt, so existing merchants keep working and can move to v2
 * when they are ready. Each retry is re-signed with its own timestamp.
 */

export type SendResult = { ok: true; status: number } | { ok: false; status?: number; error: string };

export type SendOptions = {
  /** Test-only: permit loopback receivers. Production always uses the public-only dispatcher. */
  dispatcher?: Dispatcher;
  timeoutMs?: number;
  now?: Date;
};

export async function sendWebhook(url: string, secret: string, payload: { id: string }, opts: SendOptions = {}): Promise<SendResult> {
  if (!opts.dispatcher) {
    // An IP-literal URL never goes through DNS, so the connect-time lookup
    // check would not see it. Judge the literal here instead.
    let host: string;
    try {
      host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    } catch {
      return { ok: false, error: "invalid webhook URL" };
    }
    if (isIP(host) && !isPublicAddress(host)) return { ok: false, error: "refusing to connect to a non-public address" };
  }

  const body = JSON.stringify(payload);
  const timestamp = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  try {
    const res = await undiciFetch(url, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "user-agent": "Tender-Webhooks/1",
        "x-tender-signature": signWebhook(body, secret),
        "x-tender-signature-v2": signWebhookV2(body, timestamp, secret),
        "x-tender-timestamp": String(timestamp),
        "x-tender-event-id": payload.id,
      },
      // A redirect could lead anywhere; a webhook endpoint answers directly.
      redirect: "manual",
      dispatcher: opts.dispatcher ?? publicOnlyDispatcher,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    // Drain the body so the connection is released; its content is not ours to keep.
    await res.body?.cancel().catch(() => {});
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, error: `endpoint answered ${res.status}` };
  } catch (err) {
    const cause = (err as { cause?: Error }).cause;
    return { ok: false, error: (cause?.message ?? (err as Error).message).slice(0, 300) };
  }
}
