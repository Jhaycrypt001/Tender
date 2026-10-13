import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { pino } from "pino";
import { parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loggerOptions } from "../src/lib/logger.js";
import { TRANSFER_WITH_AUTHORIZATION_TYPES } from "../src/lib/tokens.js";
import { TransferRejected, type SignedLine, type TransferChain } from "../src/services/transfer-chain.js";
import { reconcileTransfers } from "../src/services/transfer.service.js";
import { merchant as makeMerchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** Every line logged, parsed, so the test asserts on what an operator would read. */
type Line = Record<string, unknown> & { msg: string; level: number };
const lines: Line[] = [];
const stream = new Writable({
  write(chunk, _enc, cb) {
    for (const raw of chunk.toString().split("\n")) if (raw.trim()) lines.push(JSON.parse(raw) as Line);
    cb();
  },
});
const logger = pino(loggerOptions("debug", false), stream);
const find = (msg: string) => lines.filter((l) => l.msg === msg);
const WARN = 40;
const ERROR = 50;

const owner = privateKeyToAccount(generatePrivateKey());
const RECIPIENT = privateKeyToAccount(generatePrivateKey()).address;

class FakeChain implements TransferChain {
  used = new Set<string>();
  sent: { token: Hex; lines: SignedLine[] }[] = [];
  receipts = new Map<string, "success" | "reverted">();
  rejectWith: string | null = null;
  failUnknown = false;
  relayerAddress = () => "0x00000000000000000000000000000000000000aa" as Hex;
  relayerBalance = async () => parseEther("1");
  tokenBalance = async (_token: Hex, _owner: Hex) => 1_000_000_000n;
  authorizationUsed = async (_t: Hex, _a: Hex, nonce: Hex) => this.used.has(nonce);
  send = async (token: Hex, ls: SignedLine[]) => {
    if (this.rejectWith) throw new TransferRejected(this.rejectWith);
    if (this.failUnknown) throw new Error("socket hang up");
    this.sent.push({ token, lines: ls });
    return `0x${randomBytes(32).toString("hex")}` as Hex;
  };
  receipt = async (hash: Hex) => {
    const status = this.receipts.get(hash);
    return status ? { status } : null;
  };
}

let t: TestContext;
let chain: FakeChain;
let auth: { authorization: string };
let merchantId: string;
const forward: TransferChain = {
  relayerAddress: () => chain.relayerAddress(),
  relayerBalance: () => chain.relayerBalance(),
  tokenBalance: (token, who) => chain.tokenBalance(token, who),
  authorizationUsed: (token, who, nonce) => chain.authorizationUsed(token, who, nonce),
  send: (token, ls) => chain.send(token, ls),
  receipt: (hash) => chain.receipt(hash),
};

beforeAll(async () => {
  chain = new FakeChain();
  t = await setupApp({ LOG_LEVEL: "info" }, { transferChain: forward, logStream: stream });
}, 60_000);
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  chain = new FakeChain();
  lines.splice(0);
  const m = await makeMerchant(t.db);
  auth = m.auth;
  merchantId = m.merchant.id;
  await t.db.merchant.update({ where: { id: merchantId }, data: { settlementAddress: owner.address, settlementAsset: "USDC", settlementVerified: true } });
});

type Auth = { typed_data: { domain: { name: string; version: string; chainId: number; verifyingContract: Hex }; message: Record<string, string> } };
const sign = (authorizations: Auth[]) =>
  Promise.all(
    authorizations.map((a) =>
      owner.signTypedData({
        domain: a.typed_data.domain,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: "TransferWithAuthorization",
        message: {
          from: a.typed_data.message.from as Hex,
          to: a.typed_data.message.to as Hex,
          value: BigInt(a.typed_data.message.value!),
          validAfter: BigInt(a.typed_data.message.validAfter!),
          validBefore: BigInt(a.typed_data.message.validBefore!),
          nonce: a.typed_data.message.nonce as Hex,
        },
      }),
    ),
  );

const post = (url: string, payload: unknown) => t.app.inject({ method: "POST", url, headers: auth, payload: payload as object });
const prepare = () => post("/v1/transfers", { kind: "PAYOUT", lines: [{ to: RECIPIENT, amount: "12.5" }], note: "Rent" });
const reconcile = () =>
  reconcileTransfers({ db: t.db, chain, logger, config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });

describe("transfer lifecycle logging", () => {
  it("logs prepared, submitted and confirmed, each with what is needed to trace it", async () => {
    const prepared = (await prepare()).json();
    const [p] = find("transfer prepared");
    expect(p).toMatchObject({ transferId: prepared.id, merchantId, kind: "PAYOUT", asset: "USDC", from: owner.address });
    expect(p!.lines).toEqual([expect.objectContaining({ index: 0, to: RECIPIENT, destChain: null })]);

    const submitted = (await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) })).json();
    expect(find("transfer submitted to Monad")[0]).toMatchObject({ transferId: prepared.id, merchantId, txHash: submitted.tx_hash, lines: 1, kind: "PAYOUT" });

    chain.receipts.set(submitted.tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);
    await reconcile();
    expect(find("transfer confirmed on Monad")[0]).toMatchObject({ transferId: prepared.id, txHash: submitted.tx_hash, receipt: "success", status: "CONFIRMED" });
    // Confirmed once, not on every pass.
    lines.splice(0);
    await reconcile();
    expect(find("transfer confirmed on Monad")).toHaveLength(0);
  });

  it("warns when the network refuses a transfer, and nothing was broadcast", async () => {
    const prepared = (await prepare()).json();
    chain.rejectWith = "insufficient balance";
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect(res.statusCode).toBe(409);
    const [line] = find("transfer refused in simulation; nothing broadcast");
    expect(line).toMatchObject({ transferId: prepared.id, merchantId, reason: "insufficient balance" });
    expect(line!.level).toBe(WARN);
  });

  it("logs an error when a send's outcome is unknown, so reconciliation has a trail", async () => {
    const prepared = (await prepare()).json();
    chain.failUnknown = true;
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect(res.statusCode).toBe(502);
    const [line] = find("transfer send outcome unknown; reconciliation will settle it");
    expect(line).toMatchObject({ transferId: prepared.id, merchantId });
    expect(line!.level).toBe(ERROR);
  });

  it("warns when a transfer reverts on the network", async () => {
    const prepared = (await prepare()).json();
    const submitted = (await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) })).json();
    chain.receipts.set(submitted.tx_hash, "reverted");
    await reconcile();
    const [line] = find("transfer failed");
    expect(line).toMatchObject({ transferId: prepared.id, txHash: submitted.tx_hash, receipt: "reverted", status: "FAILED", failureReason: expect.stringContaining("no money moved") });
    expect(line!.level).toBe(WARN);
  });

  it("never writes a signature into the log", async () => {
    const prepared = (await prepare()).json();
    const signatures = await sign(prepared.authorizations);
    await post(`/v1/transfers/${prepared.id}/submit`, { signatures });
    const everything = JSON.stringify(lines);
    for (const s of signatures) expect(everything).not.toContain(s);
  });
});

/* -------------------------------------------------------------------------- */
/* Sending to another chain                                                    */
/* -------------------------------------------------------------------------- */

describe("cross-chain payout logging", () => {
  type Quote = { ok: true; amountOut: string | null; seconds: number | null } | { ok: false; reason: "invalid_recipient" };
  let x: TestContext;
  let xAuth: { authorization: string };
  let xMerchant: string;
  let quote: Quote;
  // Delivery is checked at most every 30s by a module-level timer, so each test starts an hour later than the last.
  let xClock = Date.now();
  const lists = { success: new Set<string>(), failed: new Set<string>() };
  const DEPOSIT = "0x00000000000000000000000000000000000000dd";
  const DEST = "0x00000000000000000000000000000000000000ee";

  const aurora = {
    tokens: async () => [
      { assetId: "monad-usdc", symbol: "USDC", blockchain: "monad", decimals: 6, price: 1 },
      { assetId: "base-usdc", symbol: "USDC", blockchain: "base", decimals: 6, price: 1 },
    ],
    routeQuote: async () => quote,
    mintAddress: async () => ({ depositAddress: DEPOSIT, alreadyExists: false }),
    submitDeposit: async () => {},
    deposits: async (address: string, type: "received" | "success" | "failed") =>
      type !== "received" && lists[type].has(address) ? [{ tx_hash: "0xout" }] : [],
  };

  beforeAll(async () => {
    x = await setupApp({ LOG_LEVEL: "info" }, { transferChain: forward, logStream: stream, aurora: aurora as never });
  }, 60_000);
  afterAll(() => teardown(x));
  beforeEach(async () => {
    await resetDb(x.db);
    chain = new FakeChain();
    lines.splice(0);
    lists.success.clear();
    lists.failed.clear();
    quote = { ok: true, amountOut: "4.99", seconds: 90 };
    const m = await makeMerchant(x.db);
    xAuth = m.auth;
    xMerchant = m.merchant.id;
    await x.db.merchant.update({ where: { id: xMerchant }, data: { settlementAddress: owner.address, settlementAsset: "USDC", settlementVerified: true } });
  });

  const xpost = (url: string, payload: unknown) => x.app.inject({ method: "POST", url, headers: xAuth, payload: payload as object });
  const crossChain = () => xpost("/v1/transfers", { kind: "PAYOUT", lines: [{ to: DEST, amount: "5", dest_chain: "base" }] });

  it("logs why a route was refused, at quote time and when preparing", async () => {
    quote = { ok: false, reason: "invalid_recipient" };
    const asked = await xpost("/v1/transfers/quote", { dest_chain: "base", to: DEST, amount: "5" });
    expect(asked.json()).toMatchObject({ ok: false, field: "to" });
    expect(find("payout route refused")[0]).toMatchObject({ merchantId: xMerchant, stage: "quote", destChain: "base", to: DEST, field: "to", reason: expect.stringContaining("not a valid") });

    lines.splice(0);
    expect((await crossChain()).statusCode).toBe(400);
    const [line] = find("payout route refused");
    expect(line).toMatchObject({ merchantId: xMerchant, stage: "prepare", kind: "PAYOUT", destChain: "base", field: "to" });
    expect(line!.level).toBe(WARN);
  });

  it("logs the destination when preparing, then delivery completing, failing and running late", async () => {
    const prepared = (await crossChain()).json();
    expect(find("transfer prepared")[0]!.lines).toEqual([
      expect.objectContaining({ to: DEPOSIT, destChain: "base", destAddress: DEST, destAsset: "USDC", destExpectedOut: "4.99" }),
    ]);
    const submitted = (await xpost(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) })).json();
    chain.receipts.set(submitted.tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);

    // A clock that moves a minute per call: delivery is only checked every 30 seconds.
    let at = (xClock += 86_400_000);
    const run = () => reconcileTransfers({ db: x.db, chain, aurora: aurora as never, logger, now: () => new Date((at += 60_000)), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });

    await run(); // confirms the Monad leg; delivery still pending and not yet late
    expect(find("cross-chain delivery is late")).toHaveLength(0);

    await x.db.transfer.update({ where: { id: prepared.id }, data: { confirmedAt: new Date(at - 11 * 60_000) } });
    await run();
    const [late] = find("cross-chain delivery is late");
    expect(late).toMatchObject({ transferId: prepared.id, depositAddress: DEPOSIT, destChain: "base", destAddress: DEST });
    expect(late!.waitingMinutes).toBeGreaterThanOrEqual(10);

    lists.success.add(DEPOSIT);
    await run();
    expect(find("cross-chain delivery completed")[0]).toMatchObject({ transferId: prepared.id, destChain: "base", destAddress: DEST });
  });

  it("still records a delivery that lands two days late, checking every 30 minutes", async () => {
    const prepared = (await crossChain()).json();
    const submitted = (await xpost(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) })).json();
    chain.receipts.set(submitted.tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);
    let at = (xClock += 86_400_000);
    const run = () => reconcileTransfers({ db: x.db, chain, aurora: aurora as never, logger, now: () => new Date(at), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });
    await run(); // confirms the Monad leg

    // Two days later, past the old 24-hour cut-off, Aurora finally delivers.
    await x.db.transfer.update({ where: { id: prepared.id }, data: { confirmedAt: new Date(at - 2 * 86_400_000) } });
    lists.success.add(DEPOSIT);
    at += 31 * 60_000;
    await run();
    const line = await x.db.transferLine.findFirstOrThrow({ where: { transferId: prepared.id } });
    expect(line.destStatus).toBe("DELIVERED");
    expect(find("cross-chain delivery completed")[0]).toMatchObject({ transferId: prepared.id });
  });

  it("reports a delivery late by more than a day once a day, not every 15 minutes", async () => {
    const prepared = (await crossChain()).json();
    const submitted = (await xpost(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) })).json();
    chain.receipts.set(submitted.tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);
    let at = (xClock += 86_400_000);
    const run = () => reconcileTransfers({ db: x.db, chain, aurora: aurora as never, logger, now: () => new Date(at), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });
    await run();
    await x.db.transfer.update({ where: { id: prepared.id }, data: { confirmedAt: new Date(at - 2 * 86_400_000) } });
    const late = () => find("cross-chain delivery is late").filter((l) => l.transferId === prepared.id);

    at += 31 * 60_000;
    await run();
    expect(late()).toHaveLength(1);
    for (let i = 0; i < 4; i++) {
      at += 31 * 60_000; // two hours of slow checks
      await run();
    }
    expect(late()).toHaveLength(1);
  });

  it("logs a delivery Aurora reports as failed", async () => {
    const prepared = (await crossChain()).json();
    const submitted = (await xpost(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) })).json();
    chain.receipts.set(submitted.tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);
    lists.failed.add(DEPOSIT);
    let at = (xClock += 86_400_000);
    const run = () => reconcileTransfers({ db: x.db, chain, aurora: aurora as never, logger, now: () => new Date((at += 60_000)), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });
    await run();
    await run();
    const [line] = find("cross-chain delivery failed at Aurora");
    expect(line).toMatchObject({ transferId: prepared.id, destChain: "base" });
    expect(line!.level).toBe(WARN);
  });
});
