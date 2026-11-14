import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NearIntentsClient, NearIntentsError } from "../src/near/client.js";
import { isNearAccountId, nearDelivery } from "../src/near/route.js";

/** A local stand-in for 1Click: records what it is asked and answers what the test says. */
let server: Server;
let url: string;
let seen: { method: string; path: string; key: string | undefined; body: Record<string, unknown> | null }[] = [];
let replies: { status: number; body: unknown }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ method: req.method!, path: req.url!, key: req.headers["x-api-key"] as string | undefined, body: raw ? JSON.parse(raw) : null });
      const r = replies.shift() ?? { status: 500, body: { message: "no reply queued" } };
      res.writeHead(r.status, { "content-type": "application/json" });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
  replies = [];
});

const client = (apiKey?: string) => new NearIntentsClient({ baseUrl: url, apiKey, maxAttempts: 3 });
const REQ = { dry: false, originAsset: "origin", destinationAsset: "dest", amount: "5000000", recipient: "alice.near", refundTo: "0x1", deadline: "2026-11-14T12:00:00.000Z" };
const QUOTE = { correlationId: "c1", signature: "sig", quote: { amountIn: "5000000", amountOut: "4988987", amountOutFormatted: "4.988987", timeEstimate: 20, depositAddress: "0xdeposit" } };

describe("the NEAR Intents client", () => {
  it("asks for a quote the way 1Click expects, and returns the one-off deposit address", async () => {
    replies.push({ status: 200, body: QUOTE });
    const res = await client("key-1").quote(REQ);

    expect(res.quote.depositAddress).toBe("0xdeposit");
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v0/quote", key: "key-1" });
    expect(seen[0]!.body).toMatchObject({ dry: false, swapType: "EXACT_INPUT", depositType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN", refundType: "ORIGIN_CHAIN", recipient: "alice.near", refundTo: "0x1", amount: "5000000" });
  });

  it("refuses a real quote that comes back without a deposit address, rather than paying nowhere", async () => {
    replies.push({ status: 200, body: { quote: { amountIn: "1", amountOut: "1" } } });
    await expect(client().quote(REQ)).rejects.toMatchObject({ kind: "upstream" });
  });

  it("retries a 503 and gives up at once on a refusal, which cannot change", async () => {
    replies.push({ status: 503, body: { message: "busy" } }, { status: 200, body: QUOTE });
    expect((await client().quote({ ...REQ, dry: true })).quote.amountOut).toBe("4988987");
    expect(seen).toHaveLength(2);

    seen = [];
    replies.push({ status: 400, body: { message: "Amount is too low, try at least 100000" } });
    await expect(client().quote(REQ)).rejects.toMatchObject({ kind: "bad_request", message: expect.stringContaining("too low") });
    expect(seen).toHaveLength(1);
  });

  it("reads a delivery's state, treats an unknown deposit address as not started, and never guesses", async () => {
    const delivery = nearDelivery(client());
    for (const [state, expected] of [["SUCCESS", "delivered"], ["REFUNDED", "failed"], ["FAILED", "failed"], ["PROCESSING", "pending"], ["SOMETHING_NEW", "pending"]] as const) {
      replies.push({ status: 200, body: { status: state } });
      expect((await delivery("0xdeposit")).state).toBe(expected);
    }
    replies.push({ status: 404, body: { message: "not found" } });
    expect((await delivery("0xdeposit")).state).toBe("pending");
    expect(seen[0]!.path).toBe("/v0/status?depositAddress=0xdeposit");

    // The proof of delivery is kept: the transaction NEAR Intents reported.
    replies.push({ status: 200, body: { status: "SUCCESS", swapDetails: { destinationChainTxHashes: [{ hash: "near-tx-1" }] } } });
    expect(await delivery("0xdeposit")).toEqual({ state: "delivered", tx: "near-tx-1" });

    // An outage is an error for the tracker to retry later, never a "failed" delivery.
    replies.push({ status: 500, body: {} });
    await expect(delivery("0xdeposit")).rejects.toBeInstanceOf(NearIntentsError);
  });

  it("never repeats a real quote (each one makes a new deposit address) and asks for status once, quietly", async () => {
    replies.push({ status: 503, body: { message: "busy" } }, { status: 200, body: QUOTE });
    await expect(client().quote(REQ)).rejects.toMatchObject({ kind: "upstream" });
    expect(seen).toHaveLength(1);

    seen = [];
    replies = [];
    const lines: { level: string; msg: string }[] = [];
    const logged = new NearIntentsClient({ baseUrl: url, logger: { debug: (_o, m) => lines.push({ level: "debug", msg: m }), info: () => {}, warn: (_o, m) => lines.push({ level: "warn", msg: m }) } });
    replies.push({ status: 404, body: { message: "Deposit address not found" } });
    expect(await logged.status("0xnew")).toBeNull();
    replies.push({ status: 503, body: {} }, { status: 200, body: { status: "SUCCESS" } });
    await expect(logged.status("0xnew")).rejects.toMatchObject({ kind: "upstream" });
    expect(seen).toHaveLength(2); // one call each: no retry on status
    expect(lines.map((l) => l.level)).toEqual(["debug", "warn"]); // an unknown address is quiet; a real failure is not
  });
});

describe("NEAR account ids", () => {
  it("accepts named and implicit accounts and refuses anything else", () => {
    for (const ok of ["alice.near", "shop.alice.tg", "a-b_c.near", "x".repeat(64), `0x${"ab".repeat(20)}`]) expect(isNearAccountId(ok), ok).toBe(true);
    for (const bad of ["", "a", "Alice.near", "alice..near", ".near", "alice near", "alice.near!", "a".repeat(65), "-alice.near"]) expect(isNearAccountId(bad), bad).toBe(false);
  });
});
