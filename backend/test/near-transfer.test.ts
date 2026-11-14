import { randomBytes } from "node:crypto";
import { getAddress, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NearIntentsError } from "../src/near/client.js";
import { nearDelivery } from "../src/near/route.js";
import type { QuoteRequest, QuoteResponse } from "../src/near/types.js";
import { TOKENS, TRANSFER_WITH_AUTHORIZATION_TYPES } from "../src/lib/tokens.js";
import { reconcileTransfers } from "../src/services/transfer.service.js";
import type { SignedLine, TransferChain } from "../src/services/transfer-chain.js";
import { merchant as makeMerchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** NEAR Intents, direct: a payout to a NEAR account, with a fake Monad and a fake NEAR Intents. */

const owner = privateKeyToAccount(generatePrivateKey());
const DEPOSIT = getAddress("0x00000000000000000000000000000000000d3905");
const MONAD_USDC = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";
const NEAR_USDC = "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";

class FakeChain implements TransferChain {
  balance = 1_000_000_000n;
  used = new Set<string>();
  sent: { token: Hex; lines: SignedLine[] }[] = [];
  receipts = new Map<string, "success" | "reverted">();
  relayerAddress = () => "0x00000000000000000000000000000000000000aa" as Hex;
  relayerBalance = async () => parseEther("1");
  tokenBalance = async (_token: Hex, _owner: Hex) => this.balance;
  authorizationUsed = async (_t: Hex, _a: Hex, nonce: Hex) => this.used.has(nonce);
  send = async (token: Hex, lines: SignedLine[]) => {
    this.sent.push({ token, lines });
    return `0x${randomBytes(32).toString("hex")}` as Hex;
  };
  receipt = async (hash: Hex) => (this.receipts.get(hash) ? { status: this.receipts.get(hash)! } : null);
}

/** What 1Click would say, and what it was asked. */
class FakeNear {
  asked: QuoteRequest[] = [];
  quoteError: NearIntentsError | null = null;
  /** Fails only the real quote (the one that makes a deposit address). */
  mintError: NearIntentsError | null = null;
  state = "PENDING_DEPOSIT";
  tokens = async () => [
    { assetId: MONAD_USDC, symbol: "USDC", blockchain: "monad", decimals: 6 },
    { assetId: NEAR_USDC, symbol: "USDC", blockchain: "near", decimals: 6 },
  ];
  quote = async (req: QuoteRequest): Promise<QuoteResponse> => {
    this.asked.push(req);
    if (this.quoteError) throw this.quoteError;
    if (!req.dry && this.mintError) throw this.mintError;
    return { correlationId: "c-1", quote: { amountIn: req.amount, amountOut: "24900000", amountOutFormatted: "24.9", timeEstimate: 20, ...(req.dry ? {} : { depositAddress: DEPOSIT }) } };
  };
  status = async (_depositAddress?: string) => ({ state: this.state, deliveredTx: null });
}

let t: TestContext;
let chain: FakeChain;
let near: FakeNear;
let auth: { authorization: string };
let merchantId: string;
/** One clock for the file: the delivery check is throttled on time, so every test must move it forward, never back. */
let clock = Date.now();

const forwardChain: TransferChain = {
  relayerAddress: () => chain.relayerAddress(),
  relayerBalance: () => chain.relayerBalance(),
  tokenBalance: (token, who) => chain.tokenBalance(token, who),
  authorizationUsed: (token, who, nonce) => chain.authorizationUsed(token, who, nonce),
  send: (token, lines) => chain.send(token, lines),
  receipt: (hash) => chain.receipt(hash),
};
const forwardNear = {
  tokens: () => near.tokens(),
  quote: (req: QuoteRequest) => near.quote(req),
  status: (a: string) => near.status(),
};

beforeAll(async () => {
  chain = new FakeChain();
  near = new FakeNear();
  t = await setupApp({}, { transferChain: forwardChain, near: forwardNear as never });
}, 60_000);
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  chain = new FakeChain();
  near = new FakeNear();
  const m = await makeMerchant(t.db);
  auth = m.auth;
  merchantId = m.merchant.id;
  await t.db.merchant.update({ where: { id: merchantId }, data: { settlementAddress: owner.address, settlementAsset: "USDC", settlementVerified: true } });
});

const post = (url: string, payload: unknown) => t.app.inject({ method: "POST", url, headers: auth, payload: payload as object });
const get = (url: string) => t.app.inject({ method: "GET", url, headers: auth });

type Auth = { index: number; typed_data: { domain: { name: string; version: string; chainId: number; verifyingContract: Hex }; message: Record<string, string> } };
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

describe("quote", () => {
  it("asks NEAR Intents for the Monad to NEAR route and says what the recipient gets", async () => {
    const res = await post("/v1/transfers/near-direct/quote", { to: "alice.near", amount: "25" });
    expect(res.json()).toEqual({ ok: true, asset: "USDC", receive: "24.9", seconds: 20 });
    expect(near.asked).toHaveLength(1);
    expect(near.asked[0]).toMatchObject({ dry: true, originAsset: MONAD_USDC, destinationAsset: NEAR_USDC, amount: "25000000", recipient: "alice.near", refundTo: owner.address });
  });

  it("names the field at fault: a bad account never reaches NEAR Intents, and a small amount says the smallest", async () => {
    const bad = await post("/v1/transfers/near-direct/quote", { to: "Not An Account", amount: "25" });
    expect(bad.json()).toMatchObject({ ok: false, field: "to" });
    expect(near.asked).toHaveLength(0);

    // A well-formed account that does not exist: 1Click answers a bare 400 "Internal server error" (seen live).
    near.quoteError = new NearIntentsError("bad_request", "Internal server error", 400);
    expect((await post("/v1/transfers/near-direct/quote", { to: "no-such-account.near", amount: "25" })).json()).toMatchObject({ ok: false, field: "to" });

    near.quoteError = new NearIntentsError("bad_request", "Amount is too low for bridge, try at least 1500000", 400);
    const small = await post("/v1/transfers/near-direct/quote", { to: "alice.near", amount: "1" });
    expect(small.json()).toMatchObject({ ok: false, field: "amount", message: expect.stringContaining("1.5 USDC") });
  });

  it("is a 503 try-again, not a verdict, when NEAR Intents cannot be reached", async () => {
    near.quoteError = new NearIntentsError("network", "timeout");
    const res = await post("/v1/transfers/near-direct/quote", { to: "alice.near", amount: "25" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("near_unavailable");
  });
});

describe("when NEAR Intents is not behaving", () => {
  it("tells a refused key or request apart from an outage: only an outage says try again", async () => {
    near.quoteError = new NearIntentsError("auth", "invalid api key", 401);
    const auth401 = await post("/v1/transfers/near-direct/quote", { to: "alice.near", amount: "5" });
    expect(auth401.statusCode).toBe(502);
    expect(auth401.json().error).toBe("near_misconfigured");

    near.quoteError = new NearIntentsError("bad_request", "refundTo is something odd", 400);
    // Not read as a bad account: the refusal is not about the recipient.
    expect((await post("/v1/transfers/near-direct/quote", { to: "alice.near", amount: "5" })).json()).toMatchObject({ ok: false, field: "chain" });
    near.quoteError = null;
    near.mintError = new NearIntentsError("bad_request", "refundTo is something odd", 400);
    const refused = await post("/v1/transfers/near-direct", { to: "alice.near", amount: "5" });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().error).toBe("route_failed");
    expect(await t.db.transfer.count()).toBe(0);
  });

  it("stops a merchant piling up unsigned payouts, each of which holds a live deposit address", async () => {
    for (let i = 0; i < 10; i++) expect((await post("/v1/transfers/near-direct", { to: "alice.near", amount: "1" })).statusCode).toBe(201);
    const eleventh = await post("/v1/transfers/near-direct", { to: "alice.near", amount: "1" });
    expect(eleventh.statusCode).toBe(429);
    expect(eleventh.json().error).toBe("too_many_pending");
    expect(near.asked.filter((q) => !q.dry)).toHaveLength(10); // the eleventh never reached NEAR Intents
  });

  it("asks NEAR Intents once per tick when it is down, so Monad transfers are not kept waiting", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const body = (await post("/v1/transfers/near-direct", { to: "alice.near", amount: "1" })).json();
      const submitted = await post(`/v1/transfers/near-direct/${body.id}/submit`, { signatures: await sign(body.authorizations) });
      chain.receipts.set(submitted.json().tx_hash, "success");
      ids.push(body.id);
    }
    for (const sent of chain.sent) for (const l of sent.lines) chain.used.add(l.nonce);
    let calls = 0;
    const down = { delivery: async () => { calls++; throw new NearIntentsError("network", "timeout"); } };
    const run = () => reconcileTransfers({ db: t.db, chain, near: down, now: () => new Date((clock += 60_000)), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });
    await run(); // confirms all three
    calls = 0;
    await run();
    expect(calls).toBe(1); // three lines are waiting; one failed call is enough to know
    // And nothing was decided on the strength of an outage.
    expect(await t.db.transferLine.count({ where: { destStatus: "PENDING" } })).toBe(3);
  });

  it("boots when the NEAR variables are declared but blank", async () => {
    const blank = await setupApp({ NEAR_INTENTS_API_KEY: "", NEAR_INTENTS_API_URL: "" });
    await teardown(blank);
  });
});

describe("a payout, end to end", () => {
  it("signs a transfer to NEAR Intents' deposit address, keeps the NEAR account as the recipient, and follows the delivery to the end", async () => {
    const prepared = await post("/v1/transfers/near-direct", { to: "alice.near", amount: "25", note: "invoice 7" });
    expect(prepared.statusCode).toBe(201);
    const body = prepared.json();
    // The wallet is shown the real recipient; the signed transfer itself goes to the one-off deposit address.
    expect(body.lines[0]).toMatchObject({ to: DEPOSIT, dest: { chain: "near", via: "near-intents", address: "alice.near", status: "PENDING" } });
    expect(body.authorizations[0].typed_data.message.to).toBe(DEPOSIT);
    // The deposit address belongs to one quote: it was asked for with the amount, and a refund comes back to the wallet.
    expect(near.asked.at(-1)).toMatchObject({ dry: false, amount: "25000000", recipient: "alice.near", refundTo: owner.address, originAsset: MONAD_USDC });
    expect((await t.db.transferLine.findFirstOrThrow({ where: { transferId: body.id } })).route).toBe("near-intents");

    const submitted = await post(`/v1/transfers/near-direct/${body.id}/submit`, { signatures: await sign(body.authorizations) });
    expect(submitted.statusCode).toBe(200);
    expect(chain.sent[0]!.lines[0]).toMatchObject({ to: DEPOSIT, value: 25_000_000n });

    const run = () => reconcileTransfers({ db: t.db, chain, near: { delivery: nearDelivery(forwardNear as never) }, now: () => new Date((clock += 60_000)), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });
    chain.receipts.set(submitted.json().tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);
    await run();
    expect((await get(`/v1/transfers/near-direct/${body.id}`)).json().status).toBe("CONFIRMED");

    // Still being carried: nothing is claimed, and asking again is harmless.
    near.state = "PROCESSING";
    await run();
    await run();
    expect((await get(`/v1/transfers/near-direct/${body.id}`)).json().lines[0].dest.status).toBe("PENDING");

    near.state = "SUCCESS";
    await run();
    await run();
    expect((await get(`/v1/transfers/near-direct/${body.id}`)).json().lines[0].dest.status).toBe("DELIVERED");
  });

  it("shows a payout NEAR Intents refunded as not delivered", async () => {
    const body = (await post("/v1/transfers/near-direct", { to: "alice.near", amount: "5" })).json();
    const submitted = await post(`/v1/transfers/near-direct/${body.id}/submit`, { signatures: await sign(body.authorizations) });
    chain.receipts.set(submitted.json().tx_hash, "success");
    for (const l of chain.sent[0]!.lines) chain.used.add(l.nonce);
    const run = () => reconcileTransfers({ db: t.db, chain, near: { delivery: nearDelivery(forwardNear as never) }, now: () => new Date((clock += 60_000)), config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });
    await run();
    near.state = "REFUNDED";
    await run();
    await run();
    expect((await get(`/v1/transfers/near-direct/${body.id}`)).json().lines[0].dest.status).toBe("FAILED");
  });

  it("refuses a bad account id with the field named, and creates nothing", async () => {
    const res = await post("/v1/transfers/near-direct", { to: "alice..near", amount: "5" });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toHaveProperty(["lines.0.to"]);
    expect(await t.db.transfer.count()).toBe(0);
    expect(near.asked).toHaveLength(0);
  });

  it("serves only its own payouts: an ordinary transfer is not found here", async () => {
    const ordinary = await post("/v1/transfers", { kind: "PAYOUT", lines: [{ to: privateKeyToAccount(generatePrivateKey()).address, amount: "1" }] });
    expect(ordinary.statusCode).toBe(201);
    expect((await get(`/v1/transfers/near-direct/${ordinary.json().id}`)).statusCode).toBe(404);
    expect((await post(`/v1/transfers/near-direct/${ordinary.json().id}/submit`, { signatures: [`0x${"11".repeat(65)}`] })).statusCode).toBe(404);
  });
});
