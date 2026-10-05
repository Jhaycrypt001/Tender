import { randomBytes } from "node:crypto";
import { parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MULTICALL3, TOKENS, TRANSFER_WITH_AUTHORIZATION_TYPES } from "../src/lib/tokens.js";
import { TransferRejected, type SignedLine, type TransferChain } from "../src/services/transfer-chain.js";
import { reconcileTransfers } from "../src/services/transfer.service.js";
import { merchant as makeMerchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

const USDC = TOKENS.USDC!;
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const RECIPIENT = privateKeyToAccount(generatePrivateKey()).address;
const RECIPIENT_2 = privateKeyToAccount(generatePrivateKey()).address;
const RECIPIENT_3 = privateKeyToAccount(generatePrivateKey()).address;
const units = (n: number | string) => BigInt(Math.round(Number(n) * 1e6));

/** An in-memory Monad: balances, spent authorizations, receipts. No RPC. */
class FakeChain implements TransferChain {
  balance = units(1000);
  relayerMon = parseEther("1");
  used = new Set<string>();
  sent: { token: Hex; lines: SignedLine[] }[] = [];
  receipts = new Map<string, "success" | "reverted">();
  rejectWith: string | null = null;
  failUnknown = false;
  rpcDown = false;

  relayerAddress = () => "0x00000000000000000000000000000000000000aa" as Hex;
  relayerBalance = async () => this.relayerMon;
  tokenBalance = async (_token: Hex, _owner: Hex) => {
    if (this.rpcDown) throw new Error("rpc down");
    return this.balance;
  };
  authorizationUsed = async (_t: Hex, _a: Hex, nonce: Hex) => {
    if (this.rpcDown) throw new Error("rpc down");
    return this.used.has(nonce);
  };
  send = async (token: Hex, lines: SignedLine[]) => {
    if (this.rejectWith) throw new TransferRejected(this.rejectWith);
    if (this.failUnknown) throw new Error("socket hang up");
    this.sent.push({ token, lines });
    return `0x${randomBytes(32).toString("hex")}` as Hex;
  };
  receipt = async (hash: Hex) => {
    const status = this.receipts.get(hash);
    return status ? { status } : null;
  };
  /** The transaction mines and executes every authorization it carried. */
  mine(hash: Hex, lines: SignedLine[], status: "success" | "reverted" = "success") {
    this.receipts.set(hash, status);
    if (status === "success") for (const l of lines) this.used.add(l.nonce);
  }
}

let t: TestContext;
let chain: FakeChain;
let auth: { authorization: string };
let merchantId: string;

/** The app is built once, so it talks to this stable object, which forwards to whichever fake chain the current test uses. */
const forward: TransferChain = {
  relayerAddress: () => chain.relayerAddress(),
  relayerBalance: () => chain.relayerBalance(),
  tokenBalance: (token, who) => chain.tokenBalance(token, who),
  authorizationUsed: (token, who, nonce) => chain.authorizationUsed(token, who, nonce),
  send: (token, lines) => chain.send(token, lines),
  receipt: (hash) => chain.receipt(hash),
};

async function boot() {
  chain = new FakeChain();
  t = await setupApp({}, { transferChain: forward });
}

beforeAll(async () => {
  await boot();
}, 60_000);
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  chain = new FakeChain();
  const m = await makeMerchant(t.db);
  auth = m.auth;
  merchantId = m.merchant.id;
  // The merchant's wallet is one whose key this test holds.
  await t.db.merchant.update({ where: { id: merchantId }, data: { settlementAddress: owner.address, settlementAsset: "USDC", settlementVerified: true } });
});

const post = (url: string, payload: unknown, headers = auth) => t.app.inject({ method: "POST", url, headers, payload: payload as object });
const get = (url: string, headers = auth) => t.app.inject({ method: "GET", url, headers });

type Auth = { index: number; typed_data: { domain: { name: string; version: string; chainId: number; verifyingContract: Hex }; message: Record<string, string> } };

/** What the merchant's wallet would do: sign each typed-data entry the API returned. */
async function sign(authorizations: Auth[], account = owner) {
  return Promise.all(
    authorizations.map((a) =>
      account.signTypedData({
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
}

async function prepare(lines: { to: string; amount: string }[], kind: "PAYOUT" | "SPLIT" | "REFUND" = lines.length > 1 ? "SPLIT" : "PAYOUT", extra: object = {}) {
  return post("/v1/transfers", { kind, lines, ...extra });
}

const reconcile = (now?: Date) =>
  reconcileTransfers({ db: t.db, chain, now: now ? () => now : undefined, config: { dailyLimit: 100, maxLines: 10, minRelayerWei: parseEther("0.02") } });

describe("the wallet endpoint", () => {
  it("reports the balance and that sending is possible", async () => {
    const res = await get("/v1/transfers/wallet");
    expect(res.json()).toMatchObject({ address: owner.address, asset: "USDC", balance: "1000.00", can_send: true });
  });

  it("says why when the wallet is not verified or the asset cannot be sent", async () => {
    await t.db.merchant.update({ where: { id: merchantId }, data: { settlementVerified: false } });
    expect((await get("/v1/transfers/wallet")).json()).toMatchObject({ can_send: false, reason: expect.stringContaining("Verify your wallet") });
    await t.db.merchant.update({ where: { id: merchantId }, data: { settlementVerified: true, settlementAsset: "MON" } });
    expect((await get("/v1/transfers/wallet")).json()).toMatchObject({ can_send: false, reason: expect.stringContaining("USDC or USDT0") });
  });

  it("says so when the relayer is out of MON", async () => {
    chain.relayerMon = 0n;
    expect((await get("/v1/transfers/wallet")).json()).toMatchObject({ can_send: false, reason: expect.stringContaining("top up") });
  });
});

describe("preparing a transfer", () => {
  it("returns the exact typed data to sign, and moves nothing", async () => {
    const res = await prepare([{ to: RECIPIENT, amount: "12.5" }], "PAYOUT", { note: "Rent" });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ kind: "PAYOUT", status: "AWAITING_SIGNATURE", asset: "USDC", from: owner.address, total_amount: "12.50", note: "Rent" });
    expect(body.authorizations).toHaveLength(1);
    expect(body.authorizations[0].typed_data).toMatchObject({
      domain: { name: "USDC", version: "2", chainId: 143, verifyingContract: USDC.address },
      primaryType: "TransferWithAuthorization",
      message: { from: owner.address, to: RECIPIENT, value: "12500000", validAfter: "0" },
    });
    expect(chain.sent).toHaveLength(0);
  });

  it.each([
    ["not an address", { to: "0x123", amount: "1" }, "lines.0.to"],
    ["the zero address", { to: "0x0000000000000000000000000000000000000000", amount: "1" }, "lines.0.to"],
    ["the token contract", { to: USDC.address, amount: "1" }, "lines.0.to"],
    ["Multicall3", { to: MULTICALL3, amount: "1" }, "lines.0.to"],
    ["their own wallet", { to: owner.address, amount: "1" }, "lines.0.to"],
    ["a zero amount", { to: RECIPIENT, amount: "0" }, "lines.0.amount"],
    ["a negative amount", { to: RECIPIENT, amount: "-1" }, "lines.0.amount"],
    ["too many decimals", { to: RECIPIENT, amount: "1.0000001" }, "lines.0.amount"],
  ])("refuses %s", async (_name, line, field) => {
    const res = await prepare([line]);
    expect(res.statusCode).toBe(400);
    expect(res.json().fields).toHaveProperty([field]);
  });

  it("refuses a mixed-case address whose checksum is wrong", async () => {
    // A known-valid checksummed address with one letter's case flipped.
    const good = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    const bad = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect((await prepare([{ to: good, amount: "1" }])).statusCode).toBe(201);
    expect((await prepare([{ to: bad, amount: "1" }])).statusCode).toBe(400);
  });

  it("refuses more than the wallet holds", async () => {
    const res = await prepare([{ to: RECIPIENT, amount: "1000.01" }]);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("insufficient_balance");
  });

  it("enforces the shape of each kind", async () => {
    expect((await prepare([{ to: RECIPIENT, amount: "1" }, { to: RECIPIENT_2, amount: "1" }], "PAYOUT")).statusCode).toBe(400);
    expect((await prepare([{ to: RECIPIENT, amount: "1" }], "SPLIT")).statusCode).toBe(400);
    expect((await prepare([{ to: RECIPIENT, amount: "1" }], "REFUND")).statusCode).toBe(400); // no payment_id
    expect((await prepare([{ to: RECIPIENT, amount: "1" }], "PAYOUT", { payment_id: "x" })).statusCode).toBe(400);
    const many = Array.from({ length: 11 }, () => ({ to: privateKeyToAccount(generatePrivateKey()).address, amount: "1" }));
    expect((await prepare(many)).statusCode).toBe(400);
  });

  it("is 503 when sending is off or the relayer is empty, and 409 for MON or an unverified wallet", async () => {
    chain.relayerMon = 0n;
    expect((await prepare([{ to: RECIPIENT, amount: "1" }])).statusCode).toBe(503);
    chain.relayerMon = parseEther("1");
    await t.db.merchant.update({ where: { id: merchantId }, data: { settlementAsset: "MON" } });
    expect((await prepare([{ to: RECIPIENT, amount: "1" }])).json().error).toBe("asset_unsupported");
    await t.db.merchant.update({ where: { id: merchantId }, data: { settlementAsset: "USDC", settlementVerified: false } });
    expect((await prepare([{ to: RECIPIENT, amount: "1" }])).statusCode).toBe(409);
  });

  it("stops a merchant past the daily limit", async () => {
    const limited = await setupApp({ TRANSFER_DAILY_LIMIT: "1" }, { transferChain: forward });
    try {
      const m = await makeMerchant(limited.db);
      await limited.db.merchant.update({ where: { id: m.merchant.id }, data: { settlementAddress: owner.address, settlementAsset: "USDC" } });
      const first = await limited.app.inject({ method: "POST", url: "/v1/transfers", headers: m.auth, payload: { kind: "PAYOUT", lines: [{ to: RECIPIENT, amount: "1" }] } });
      const signatures = await sign(first.json().authorizations);
      await limited.app.inject({ method: "POST", url: `/v1/transfers/${first.json().id}/submit`, headers: m.auth, payload: { signatures } });
      const second = await limited.app.inject({ method: "POST", url: "/v1/transfers", headers: m.auth, payload: { kind: "PAYOUT", lines: [{ to: RECIPIENT, amount: "1" }] } });
      expect(second.statusCode).toBe(429);
      expect(second.json().error).toBe("daily_limit");
    } finally {
      await teardown(limited);
    }
  });
});

describe("submitting signatures", () => {
  it("relays a valid signature, then confirms only when the chain says so", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "12.5" }])).json();
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "SUBMITTED", tx_hash: expect.stringMatching(/^0x[0-9a-f]{64}$/) });

    expect(chain.sent).toHaveLength(1);
    const [only] = chain.sent[0]!.lines;
    expect(only).toMatchObject({ from: owner.address, to: RECIPIENT, value: units(12.5), validAfter: 0n });

    // Submitted is not sent: nothing is confirmed until a receipt says so.
    await reconcile();
    expect((await get(`/v1/transfers/${prepared.id}`)).json().status).toBe("SUBMITTED");

    chain.mine(res.json().tx_hash, chain.sent[0]!.lines);
    expect(await reconcile()).toMatchObject({ confirmed: 1 });
    expect((await get(`/v1/transfers/${prepared.id}`)).json()).toMatchObject({ status: "CONFIRMED", confirmed_at: expect.any(String) });
    expect(await reconcile()).toMatchObject({ confirmed: 0 }); // idempotent
  });

  it("rejects a signature from any other wallet", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations, stranger) });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields["signatures.0"]).toContain("does not come from your wallet");
    expect(chain.sent).toHaveLength(0);
  });

  it("rejects a signature over a different recipient or amount than the one prepared", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const tampered = structuredClone(prepared.authorizations) as Auth[];
    tampered[0]!.typed_data.message.to = RECIPIENT_2;
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(tampered) });
    expect(res.statusCode).toBe(400);
    const bigger = structuredClone(prepared.authorizations) as Auth[];
    bigger[0]!.typed_data.message.value = "999000000";
    expect((await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(bigger) })).statusCode).toBe(400);
    expect(chain.sent).toHaveLength(0);
  });

  it("rejects the wrong number of signatures and malformed ones", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }, { to: RECIPIENT_2, amount: "5" }])).json();
    const [one] = await sign(prepared.authorizations);
    expect((await post(`/v1/transfers/${prepared.id}/submit`, { signatures: [one] })).statusCode).toBe(400);
    expect((await post(`/v1/transfers/${prepared.id}/submit`, { signatures: ["0x12", "0x34"] })).statusCode).toBe(400);
  });

  it("lets exactly one of two simultaneous submits through", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const signatures = await sign(prepared.authorizations);
    const [a, b] = await Promise.all([post(`/v1/transfers/${prepared.id}/submit`, { signatures }), post(`/v1/transfers/${prepared.id}/submit`, { signatures })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(chain.sent).toHaveLength(1);
  });

  it("sends a split as ONE transaction carrying every line", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "10" }, { to: RECIPIENT_2, amount: "20" }, { to: RECIPIENT_3, amount: "30.5" }])).json();
    expect(prepared).toMatchObject({ kind: "SPLIT", total_amount: "60.50" });
    expect(prepared.authorizations).toHaveLength(3);
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect(res.statusCode).toBe(200);
    expect(chain.sent).toHaveLength(1);
    expect(chain.sent[0]!.lines.map((l) => [l.to, l.value])).toEqual([[RECIPIENT, units(10)], [RECIPIENT_2, units(20)], [RECIPIENT_3, units(30.5)]]);
    expect(new Set(chain.sent[0]!.lines.map((l) => l.nonce)).size).toBe(3);
  });

  it("marks a transfer the network refused as FAILED, with nothing sent", async () => {
    chain.rejectWith = "transfer amount exceeds balance";
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect(res.statusCode).toBe(409);
    const after = (await get(`/v1/transfers/${prepared.id}`)).json();
    expect(after).toMatchObject({ status: "FAILED", tx_hash: null });
    expect(after.failure_reason).toContain("nothing was sent");
  });

  it("is 410 once the signing window has passed, and the transfer expires", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const signatures = await sign(prepared.authorizations);
    await t.db.transfer.update({ where: { id: prepared.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post(`/v1/transfers/${prepared.id}/submit`, { signatures })).statusCode).toBe(410);
    expect((await get(`/v1/transfers/${prepared.id}`)).json().status).toBe("EXPIRED");
    expect(chain.sent).toHaveLength(0);
  });

  it("is private to its merchant", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const other = await makeMerchant(t.db, { email: "other@acme.test" });
    expect((await get(`/v1/transfers/${prepared.id}`, other.auth)).statusCode).toBe(404);
    expect((await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) }, other.auth)).statusCode).toBe(404);
    expect((await get("/v1/transfers", other.auth)).json().data).toEqual([]);
  });
});

describe("reconciling against the chain", () => {
  async function submitted() {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    return { id: prepared.id as string, hash: res.json().tx_hash as Hex, lines: chain.sent.at(-1)!.lines };
  }

  it("fails a reverted transaction when nothing was spent", async () => {
    const s = await submitted();
    chain.receipts.set(s.hash, "reverted");
    expect(await reconcile()).toMatchObject({ failed: 1 });
    expect((await get(`/v1/transfers/${s.id}`)).json()).toMatchObject({ status: "FAILED", failure_reason: expect.stringContaining("no money moved") });
  });

  it("confirms when someone else submitted the same signature first", async () => {
    const s = await submitted();
    chain.receipts.set(s.hash, "reverted");
    for (const l of s.lines) chain.used.add(l.nonce);
    expect(await reconcile()).toMatchObject({ confirmed: 1 });
  });

  it("settles a send that errored unknown from the nonces alone", async () => {
    chain.failUnknown = true;
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    const res = await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect(res.statusCode).toBe(502);
    expect((await get(`/v1/transfers/${prepared.id}`)).json()).toMatchObject({ status: "SUBMITTED", tx_hash: null });

    // Not spent, and not yet expired: keep waiting.
    expect(await reconcile()).toMatchObject({ confirmed: 0, failed: 0 });
    // Spent on-chain after all: the money moved as signed.
    const row = await t.db.transfer.findUniqueOrThrow({ where: { id: prepared.id }, include: { lines: true } });
    chain.used.add(row.lines[0]!.nonce);
    expect(await reconcile()).toMatchObject({ confirmed: 1 });
  });

  it("gives up on a transaction never mined once the signatures have expired", async () => {
    const s = await submitted();
    const later = new Date(Date.now() + 40 * 60_000);
    expect(await reconcile(later)).toMatchObject({ failed: 1 });
    expect((await get(`/v1/transfers/${s.id}`)).json().failure_reason).toContain("signatures have expired");
  });

  it("leaves everything alone while the RPC is down", async () => {
    const s = await submitted();
    chain.rpcDown = true;
    expect(await reconcile()).toMatchObject({ confirmed: 0, failed: 0 });
    expect((await get(`/v1/transfers/${s.id}`)).json().status).toBe("SUBMITTED");
  });

  it("expires unsigned transfers", async () => {
    const prepared = (await prepare([{ to: RECIPIENT, amount: "5" }])).json();
    expect(await reconcile(new Date(Date.now() + 20 * 60_000))).toMatchObject({ expired: 1 });
    expect((await get(`/v1/transfers/${prepared.id}`)).json().status).toBe("EXPIRED");
  });
});

describe("refunds", () => {
  async function settledPayment(amountSettled = "100", from: string | null = "0xBuyer000000000000000000000000000000beef") {
    const invoice = await t.db.invoice.create({
      data: { id: `inv_${randomBytes(6).toString("hex")}`, token: `chk_${randomBytes(8).toString("hex")}`, merchantId, reference: `R-${randomBytes(3).toString("hex")}`, amountExpected: amountSettled, currency: "USD", chains: ["base"], status: "SETTLED", expiresAt: new Date(Date.now() + 3600_000) },
    });
    const address = await t.db.invoiceAddress.create({ data: { invoiceId: invoice.id, family: "evm", address: `0x${randomBytes(20).toString("hex")}`, auroraSender: invoice.id } });
    return t.db.payment.create({
      data: {
        invoiceId: invoice.id,
        invoiceAddressId: address.id,
        auroraTxHash: `0x${randomBytes(32).toString("hex")}`,
        fromChain: "base",
        amountIn: amountSettled,
        amountSettled,
        status: "SETTLED",
        settledAt: new Date(),
        raw: { received: { from } },
      },
    });
  }

  const refund = (paymentId: string, amount: string, to = RECIPIENT) => prepare([{ to, amount }], "REFUND", { payment_id: paymentId });

  it("shows the buyer's address and how much is already refunded on the payment", async () => {
    const p = await settledPayment();
    expect((await get(`/v1/payments/${p.id}`)).json()).toMatchObject({ sender: "0xBuyer000000000000000000000000000000beef", refunded_amount: null });
    const prepared = (await refund(p.id, "40")).json();
    await post(`/v1/transfers/${prepared.id}/submit`, { signatures: await sign(prepared.authorizations) });
    expect((await get(`/v1/payments/${p.id}`)).json().refunded_amount).toBe("40.00");
    expect((await get("/v1/payments")).json().data[0]).toMatchObject({ id: p.id, refunded_amount: "40.00" });
  });

  it("caps refunds at what the payment delivered, counting refunds already made or under way", async () => {
    const p = await settledPayment("100");
    const first = (await refund(p.id, "60")).json();
    // 60 is reserved even before it is signed: a second refund cannot take it.
    const second = await refund(p.id, "50");
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("over_refund");
    expect(second.json().message).toContain("40.00");

    await post(`/v1/transfers/${first.id}/submit`, { signatures: await sign(first.authorizations) });
    expect((await refund(p.id, "40")).statusCode).toBe(201);
    expect((await refund(p.id, "40.01")).statusCode).toBe(409);
  });

  it("gives the money back to the cap if a refund fails or expires", async () => {
    const p = await settledPayment("100");
    const first = (await refund(p.id, "100")).json();
    expect((await refund(p.id, "1")).json().message).toContain("already been refunded in full");
    await t.db.transfer.update({ where: { id: first.id }, data: { status: "FAILED" } });
    expect((await refund(p.id, "100")).statusCode).toBe(201);
  });

  it("lets only two simultaneous refunds share what is left", async () => {
    const p = await settledPayment("100");
    const [a, b] = await Promise.all([refund(p.id, "70"), refund(p.id, "70")]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });

  it("refuses an unsettled payment, another merchant's payment, and an unknown one", async () => {
    const p = await settledPayment();
    await t.db.payment.update({ where: { id: p.id }, data: { status: "DETECTED" } });
    expect((await refund(p.id, "1")).statusCode).toBe(409);

    const mine = await settledPayment();
    const other = await makeMerchant(t.db, { email: "other2@acme.test" });
    await t.db.merchant.update({ where: { id: other.merchant.id }, data: { settlementAddress: owner.address, settlementAsset: "USDC" } });
    const res = await t.app.inject({ method: "POST", url: "/v1/transfers", headers: other.auth, payload: { kind: "REFUND", payment_id: mine.id, lines: [{ to: RECIPIENT, amount: "1" }] } });
    expect(res.statusCode).toBe(404);
    expect((await refund("pay_nope", "1")).statusCode).toBe(404);
  });

  it("reports no sender when Aurora gave none", async () => {
    const p = await settledPayment("10", null);
    expect((await get(`/v1/payments/${p.id}`)).json().sender).toBeNull();
  });
});
