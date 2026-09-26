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
    expect(tenderChainName("zec")).toBe("zec");
    expect(tenderChainName(null)).toBe("unknown");
  });
});
