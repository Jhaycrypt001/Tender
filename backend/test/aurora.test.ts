import { describe, expect, it, vi } from "vitest";
import { chainsInFamily, familiesFor, tenderChainName } from "../src/aurora/chains.js";
import { AuroraClient, AuroraError } from "../src/aurora/client.js";
import { createLogger } from "../src/lib/logger.js";

const KEY = "test-key-123";

function client(responses: Array<Response | Error>) {
  const fetch = vi.fn(async () => {
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const logs: unknown[] = [];
  const logger = createLogger("warn", false);
  logger.warn = ((obj: unknown) => logs.push(obj)) as typeof logger.warn;
  const aurora = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: KEY, logger, fetch, maxAttempts: 3 });
  return { aurora, fetch, logs };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const MINTED = { depositAddress: "0xabc", alreadyExists: false };
const MINT_INPUT = { recipient: "0x1", sender: "inv_1", depositChain: "evm", destinationChain: "monad", destinationAsset: "USDC" };

describe("AuroraClient", () => {
  it("parses a successful mint", async () => {
    const { aurora, fetch } = client([json(200, MINTED)]);
    await expect(aurora.mintAddress(MINT_INPUT)).resolves.toEqual(MINTED);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("says WHY a retried request failed: a dropped connection, a timeout, an Aurora 500, and never the API key", async () => {
    const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET", message: `https://aurora.test/x?key=${KEY}` } });
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    const { aurora, logs } = client([reset, timeout, json(500, { message: "boom" }), json(200, MINTED)]);
    // maxAttempts is 3, so the 4th response is never reached; the point is the three failure lines.
    await expect(aurora.mintAddress(MINT_INPUT)).rejects.toBeInstanceOf(AuroraError);

    // Only the per-attempt lines: the client logs one more summary warning once retries run out.
    const lines = (logs as Array<{ attempt?: number; kind: string; status?: number; ms: number; reason: string }>).filter((l) => l.attempt !== undefined);
    expect(lines.map((l) => [l.attempt, l.kind, l.status])).toEqual([[1, "network", undefined], [2, "network", undefined], [3, "upstream", 500]]);
    expect(lines[0]!.reason).toBe("TypeError:ECONNRESET");
    expect(lines[1]!.reason).toBe("TimeoutError");
    expect(lines[2]!.reason).toContain("500");
    expect(lines.every((l) => typeof l.ms === "number" && l.ms >= 0)).toBe(true);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });

  it("logs a 403 loudly, without the API key, and does not retry it", async () => {
    const fetch = vi.fn(async () => json(403, { message: "Persistent deposit address creation is not enabled for this API key" }));
    const errors: Record<string, unknown>[] = [];
    const logger = createLogger("fatal", false);
    logger.error = ((obj: Record<string, unknown>) => errors.push(obj)) as typeof logger.error;
    const aurora = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: KEY, logger, fetch, maxAttempts: 3 });
    await expect(aurora.mintAddress(MINT_INPUT)).rejects.toBeInstanceOf(AuroraError);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ status: 403 });
    expect(String(errors[0]!.message)).toContain("not enabled for this API key");
    expect(JSON.stringify(errors)).not.toContain(KEY);
  });

  it("does not log a refused quote as an error: that is how minimums are measured", async () => {
    const fetch = vi.fn(async () => json(400, { message: "Failed to get quote" }));
    const errors: unknown[] = [];
    const logger = createLogger("fatal", false);
    logger.error = ((obj: unknown) => errors.push(obj)) as typeof logger.error;
    const aurora = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: KEY, logger, fetch, maxAttempts: 3 });
    await expect(aurora.dryQuote({ originAsset: "a", destinationAsset: "b", amount: "1", recipient: "0x1", refundTo: "x" })).resolves.toBeNull();
    expect(errors).toHaveLength(0);
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const { aurora, fetch } = client([json(429, { message: "busy" }), json(502, {}), json(200, MINTED)]);
    await expect(aurora.mintAddress(MINT_INPUT)).resolves.toEqual(MINTED);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries network errors", async () => {
    const { aurora, fetch } = client([new TypeError("fetch failed"), json(200, MINTED)]);
    await expect(aurora.mintAddress(MINT_INPUT)).resolves.toEqual(MINTED);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 400", async () => {
    const { aurora, fetch } = client([json(400, { message: "Multiple tokens with symbol USDC" })]);
    const err = await aurora.mintAddress(MINT_INPUT).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuroraError);
    expect((err as AuroraError).kind).toBe("bad_request");
    expect((err as AuroraError).message).toContain("Multiple tokens");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts with a retryable error", async () => {
    const { aurora, fetch } = client([json(503, {}), json(503, {}), json(503, {})]);
    await expect(aurora.mintAddress(MINT_INPUT)).rejects.toMatchObject({ kind: "upstream", status: 503 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("keeps the readable deposits when one entry in a list is malformed, and names the bad one once", async () => {
    const good = { tx_hash: "good", fromChain: "base", asset_id: "a", decimals: 6, amount: "1000000", created_at: "2026-11-01T00:00:00Z", intents_account: "i", deposit_address: "0xabc", recipient: "0x1" };
    const bad = { tx_hash: "bad_tx", amount: 12.5 };
    const errors: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async () => json(200, { deposits: [good, bad] }));
    const logger = createLogger("fatal", false);
    logger.error = ((obj: Record<string, unknown>) => errors.push(obj)) as typeof logger.error;
    const aurora = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: KEY, logger, fetch, maxAttempts: 3 });

    expect((await aurora.deposits("0xabc", "received")).map((d) => d.tx_hash)).toEqual(["good"]);
    await aurora.deposits("0xabc", "received");
    // Polled every 10 seconds, so the same bad entry must not be reported on every poll.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ address: "0xabc", tx: "bad_tx" });
    expect(JSON.stringify(errors)).not.toContain(KEY);
  });

  it("sends a buyer's transaction hash to Aurora once, never retrying a POST whose repeat-safety is unknown", async () => {
    const { aurora, fetch } = client([json(500, {}), json(200, {})]);
    await expect(aurora.submitDeposit("0xhash", "0xaddr")).rejects.toMatchObject({ kind: "upstream" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 408, and names a 200 that is not JSON as an upstream fault rather than a network one", async () => {
    const timeout = client([json(408, {}), json(200, MINTED)]);
    await expect(timeout.aurora.mintAddress(MINT_INPUT)).resolves.toMatchObject({ depositAddress: "0xabc" });
    expect(timeout.fetch).toHaveBeenCalledTimes(2);

    const html = () => new Response("<html>bad gateway</html>", { status: 200, headers: { "content-type": "text/html" } });
    const page = client([html(), html(), html()]);
    await expect(page.aurora.mintAddress(MINT_INPUT)).rejects.toMatchObject({ kind: "upstream", message: expect.stringContaining("not JSON") });
  });

  it("rejects a response that does not match the expected shape", async () => {
    const { aurora } = client([json(200, { address: "0xabc" })]);
    await expect(aurora.mintAddress(MINT_INPUT)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("never puts the API key in a log line or an error message", async () => {
    const { aurora, logs } = client([json(500, {}), json(500, {}), json(500, {})]);
    const err = (await aurora.deposits("0xabc", "received").catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(KEY);
    expect(JSON.stringify(logs)).not.toContain(KEY);
  });
});

describe("chain families", () => {
  it("collapses every EVM chain into one family", () => {
    expect(familiesFor(["base", "arbitrum", "ethereum", "monad", "solana", "bitcoin"]).sort()).toEqual(["btc", "evm", "sol"]);
  });

  it("maps a family back to the accepted chains it serves", () => {
    expect(chainsInFamily("evm", ["base", "solana", "monad"])).toEqual(["base", "monad"]);
  });

  it("maps Aurora codes to Tender names", () => {
    expect(tenderChainName("sol")).toBe("solana");
    expect(tenderChainName("arb")).toBe("arbitrum");
    expect(tenderChainName("zec")).toBe("zcash");
    expect(tenderChainName("bsc")).toBe("bnb");
    // A code we do not serve (Stellar needs a memo) passes through unchanged.
    expect(tenderChainName("stellar")).toBe("stellar");
    expect(tenderChainName(null)).toBe("unknown");
  });
});
