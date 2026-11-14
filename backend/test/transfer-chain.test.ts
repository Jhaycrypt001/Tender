import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, http, type Hex, type PublicClient } from "viem";
import { monad } from "viem/chains";
import { createTransferChain, TransferNotSent, TransferRejected, type SignedLine } from "../src/services/transfer-chain.js";

/** A node that answers just enough JSON-RPC for a send, and records how many nonce reads overlap. */
let server: Server;
let url: string;
let estimateError: { code: number; message: string } | null = null;
let rawSent: string[] = [];
let readingNonce = 0;
let maxOverlap = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      const { id, method } = JSON.parse(body);
      const reply = (result: unknown) => res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      switch (method) {
        case "eth_estimateGas":
          if (estimateError) return res.end(JSON.stringify({ jsonrpc: "2.0", id, error: estimateError }));
          return reply("0x5208");
        case "eth_getTransactionCount": {
          readingNonce++;
          maxOverlap = Math.max(maxOverlap, readingNonce);
          await new Promise((r) => setTimeout(r, 40));
          readingNonce--;
          return reply("0x" + rawSent.length.toString(16));
        }
        case "eth_chainId":
          return reply("0x" + monad.id.toString(16));
        case "eth_getBlockByNumber":
          return reply({ number: "0x1", baseFeePerGas: "0x1", gasLimit: "0x1c9c380", timestamp: "0x1", transactions: [] });
        case "eth_maxPriorityFeePerGas":
          return reply("0x1");
        case "eth_gasPrice":
          return reply("0x2");
        case "eth_sendRawTransaction":
          rawSent.push(JSON.parse(body).params[0]);
          return reply("0x" + "ab".repeat(32));
        default:
          return res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: `no ${method}` } }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const line: SignedLine = {
  from: "0x1111111111111111111111111111111111111111",
  to: "0x2222222222222222222222222222222222222222",
  value: 1_000_000n,
  validAfter: 0n,
  validBefore: 9_999_999_999n,
  nonce: `0x${"01".repeat(32)}`,
  signature: `0x${"11".repeat(32)}${"22".repeat(32)}1b`,
};
const TOKEN = "0x3333333333333333333333333333333333333333" as Hex;
const chain = () =>
  createTransferChain({
    client: createPublicClient({ chain: monad, transport: http(url, { retryCount: 0 }) }) as PublicClient,
    rpcUrl: url,
    relayerKey: `0x${"ab".repeat(32)}`,
  });

describe("relayer sends", () => {
  it("calls only the chain's own refusal a rejection; an RPC that could not answer is not a verdict on the transfer", async () => {
    estimateError = { code: 3, message: "execution reverted: FiatTokenV2: authorization is used" };
    await expect(chain().send(TOKEN, [line])).rejects.toBeInstanceOf(TransferRejected);

    estimateError = { code: -32005, message: "rate limited" };
    await expect(chain().send(TOKEN, [line])).rejects.toBeInstanceOf(TransferNotSent);
    // Not our fault and not the user's: the relayer has no gas. Retryable once someone tops it up.
    estimateError = { code: -32000, message: "insufficient funds for gas * price + value" };
    await expect(chain().send(TOKEN, [line])).rejects.toBeInstanceOf(TransferNotSent);

    // The node judged the call and said no, without the word revert: retrying changes nothing, so it is a rejection.
    estimateError = { code: -32602, message: "invalid argument 0: hex string has odd length" };
    await expect(chain().send(TOKEN, [line])).rejects.toBeInstanceOf(TransferRejected);
    estimateError = null;
    expect(rawSent).toHaveLength(0);
  });

  it("builds and broadcasts one transaction at a time, so two sends never read the same nonce", async () => {
    rawSent = [];
    maxOverlap = 0;
    const c = chain();
    const hashes = await Promise.all([c.send(TOKEN, [line]), c.send(TOKEN, [line]), c.send(TOKEN, [line])]);
    expect(hashes).toHaveLength(3);
    expect(rawSent).toHaveLength(3);
    expect(maxOverlap).toBe(1);
  });
});
