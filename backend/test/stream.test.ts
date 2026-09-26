import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publishInvoiceEvent } from "../src/services/events.js";
import { merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
let base: string;

beforeAll(async () => {
  t = await setupApp();
  await t.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(t.app.server.address() as AddressInfo).port}`;
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  t.aurora.submitDeposit.mockClear();
});

async function invoice() {
  const m = await merchant(t.db);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: "49.00", currency: "USD", reference: `order_${Math.random()}`, chains: ["base", "solana"] },
  });
  return res.json() as { id: string; token: string };
}

/** Reads SSE `data:` frames until `count` arrive or the stream ends. */
async function frames(res: Response, count: number, timeoutMs = 3000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const out: Array<Record<string, unknown>> = [];
  let buffer = "";
  let ended = false;
  const deadline = Date.now() + timeoutMs;
  while (out.length < count && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), deadline - Date.now())),
    ]);
    if (done) {
      ended = true;
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "));
      if (data) out.push(JSON.parse(data.slice(6)));
    }
  }
  return { frames: out, ended, reader };
}

describe("GET /public/invoices/:token/events", () => {
  it("sends the current status first, then each change, and closes on a terminal state", async () => {
    const inv = await invoice();
    const res = await fetch(`${base}/public/invoices/${inv.token}/events`, { headers: { origin: "http://localhost:3000" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");

    const first = await frames(res, 1);
    expect(first.frames[0]).toMatchObject({ status: "PENDING" });

    // The poller publishes through Redis; the API process relays it.
    const at = new Date().toISOString();
    await publishInvoiceEvent(t.redis, inv.token, { status: "DETECTED", at });
    await publishInvoiceEvent(t.redis, inv.token, { status: "SETTLED", at });

    // Ask for one more frame than expected: the read then runs until the server closes.
    const rest = await readMore(first.reader, 3);
    expect(rest.frames.map((f) => f.status)).toEqual(["DETECTED", "SETTLED"]);
    expect(rest.ended).toBe(true);
  });

  it("closes immediately for an invoice that is already final", async () => {
    const inv = await invoice();
    await t.db.invoice.update({ where: { id: inv.id }, data: { status: "SETTLED" } });
    const res = await fetch(`${base}/public/invoices/${inv.token}/events`);
    const { frames: got, ended } = await frames(res, 2);
    expect(got).toEqual([expect.objectContaining({ status: "SETTLED" })]);
    expect(ended).toBe(true);
  });

  it("404s for an unknown token without opening a stream", async () => {
    const res = await fetch(`${base}/public/invoices/chk_AAAAAAAAAAAAAAAAAAAAAAAAAAA/events`);
    expect(res.status).toBe(404);
  });
});

describe("POST /public/invoices/:token/submit-tx", () => {
  it("offers the hash to Aurora for each address and polls the invoice next tick", async () => {
    const inv = await invoice();
    await t.db.invoiceAddress.updateMany({ where: { invoiceId: inv.id }, data: { nextPollAt: new Date(Date.now() + 60_000) } });

    const res = await t.app.inject({ method: "POST", url: `/public/invoices/${inv.token}/submit-tx`, payload: { tx_hash: "0xabc123def456" } });
    expect(res.json()).toEqual({ accepted: true });
    expect(t.aurora.submitDeposit).toHaveBeenCalledTimes(2);
    const due = await t.db.invoiceAddress.count({ where: { invoiceId: inv.id, nextPollAt: { lte: new Date() } } });
    expect(due).toBe(2);
  });

  it("rejects a malformed hash and ignores closed invoices", async () => {
    const inv = await invoice();
    const bad = await t.app.inject({ method: "POST", url: `/public/invoices/${inv.token}/submit-tx`, payload: { tx_hash: "<script>" } });
    expect(bad.statusCode).toBe(400);

    await t.db.invoice.update({ where: { id: inv.id }, data: { status: "CANCELLED" } });
    const closed = await t.app.inject({ method: "POST", url: `/public/invoices/${inv.token}/submit-tx`, payload: { tx_hash: "0xabc123def456" } });
    expect(closed.json()).toEqual({ accepted: false });
    expect(t.aurora.submitDeposit).not.toHaveBeenCalled();
  });
});

/** Continues reading an already-open stream. */
async function readMore(reader: ReadableStreamDefaultReader<Uint8Array>, count: number) {
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
  });
  return frames(new Response(body), count);
}
