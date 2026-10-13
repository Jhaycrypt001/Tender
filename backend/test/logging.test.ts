import Fastify from "fastify";
import { pino } from "pino";
import { Writable } from "node:stream";
import { parseEther } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuroraClient } from "../src/aurora/client.js";
import { chainFromAssetId } from "../src/aurora/chains.js";
import { PriceBook } from "../src/aurora/prices.js";
import { loggerOptions } from "../src/lib/logger.js";
import { registerRateLimits } from "../src/lib/rate-limit.js";
import { requireMerchant } from "../src/routes/auth.js";
import { reconcileTransfers } from "../src/services/transfer.service.js";
import { Poller } from "../src/workers/poller.js";
import { ASSETS, deposit, merchant, POLLER_CONFIG, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** Every line the code under test logs, as parsed JSON, so a test can assert on what an operator would actually see. */
type Line = Record<string, unknown> & { msg: string; level: number };
function capture() {
  const lines: Line[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      for (const raw of chunk.toString().split("\n")) if (raw.trim()) lines.push(JSON.parse(raw) as Line);
      cb();
    },
  });
  return {
    lines,
    stream,
    logger: pino(loggerOptions("debug", false), stream),
    find: (msg: string) => lines.filter((l) => l.msg === msg),
    clear: () => lines.splice(0),
  };
}
const WARN = 40;
const ERROR = 50;

let t: TestContext;
const appLog = capture();

beforeAll(async () => {
  t = await setupApp({ LOG_LEVEL: "info" }, { logStream: appLog.stream });
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.redis.flushdb();
  appLog.clear();
});

describe("chainFromAssetId", () => {
  it("reads the chain from a bridged asset id", () => {
    expect(chainFromAssetId("hood.omft.near")).toBe("hood");
    expect(chainFromAssetId("nep141:eth.omft.near")).toBe("eth");
    expect(chainFromAssetId("base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near")).toBe("base");
    expect(chainFromAssetId("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near")).toBe("sol");
  });

  it("never mistakes a NEAR-native token or a hot-bridge id for a chain", () => {
    expect(chainFromAssetId("nep141:wrap.near")).toBeNull();
    expect(chainFromAssetId("nep141:token.rhealab.near")).toBeNull();
    expect(chainFromAssetId("nep141:abg-966.meme-cooking.near")).toBeNull();
    expect(chainFromAssetId("nep245:v2_1.omni.hot.tg:56_11111111111111111111")).toBeNull();
    expect(chainFromAssetId(null)).toBeNull();
    expect(chainFromAssetId("")).toBeNull();
  });
});

describe("address minting", () => {
  const input = { recipient: "0xrecipient", sender: "inv_1", depositChain: "evm", destinationChain: "monad", destinationAsset: "USDC" };

  it("logs who an address was minted for, and never the API key", async () => {
    const log = capture();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ depositAddress: "0xdeposit", alreadyExists: false, correlationId: "c1" }), { status: 200 }));
    const client = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: "sk_super_secret_key", logger: log.logger, fetch: fetchImpl as unknown as typeof fetch });
    await client.mintAddress(input);

    const [line] = log.find("deposit address minted");
    expect(line).toMatchObject({ ...input, address: "0xdeposit", alreadyExists: false, correlationId: "c1" });
    expect(line!.ms).toEqual(expect.any(Number));
    expect(JSON.stringify(log.lines)).not.toContain("sk_super_secret_key");
  });

  it("logs Tender's own probe mints at debug, so they never reach the normal log", async () => {
    const log = capture();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ depositAddress: "0xprobe", alreadyExists: true }), { status: 200 }));
    const client = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: "sk_super_secret_key", logger: log.logger, fetch: fetchImpl as unknown as typeof fetch });
    await client.mintAddress({ ...input, sender: "tender-minimum-probe" }, { quiet: true });
    const [line] = log.find("deposit address minted");
    expect(line!.level).toBe(20); // debug
  });

  it("logs a failed mint as a warning with its reason", async () => {
    const log = capture();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Invalid option" }), { status: 400 }));
    const client = new AuroraClient({ baseUrl: "https://aurora.test", apiKey: "sk_super_secret_key", logger: log.logger, maxAttempts: 1, fetch: fetchImpl as unknown as typeof fetch });
    await expect(client.mintAddress({ ...input, depositChain: "hood" })).rejects.toThrow();

    const [line] = log.find("deposit address mint failed");
    expect(line).toMatchObject({ depositChain: "hood", kind: "bad_request" });
    expect(line!.level).toBe(WARN);
    expect(String(line!.err)).toContain("Invalid option");
    expect(JSON.stringify(log.lines)).not.toContain("sk_super_secret_key");
  });
});

/** An invoice on Base and Solana, as the poller tests build it. */
async function invoice() {
  const m = await merchant(t.db);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: "49.00", currency: "USD", reference: `order_${Math.random()}`, chains: ["base", "solana"] },
  });
  const inv = res.json() as { id: string; addresses: { chain: string; address: string }[] };
  return { m, ...inv, evm: inv.addresses.find((a) => a.chain === "base")!.address };
}

function loggedPoller(clock: { now: Date }) {
  const log = capture();
  const poller = new Poller({
    db: t.db,
    aurora: t.aurora,
    prices: new PriceBook(t.aurora),
    redis: { publish: vi.fn(async () => 1) } as never,
    logger: log.logger,
    config: POLLER_CONFIG,
    now: () => clock.now,
  });
  return { poller, log };
}

const usdc = (address: string, dollars: number, extra: { tx?: string; fromChain?: string } = {}) =>
  deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), ...extra });

describe("poller logging", () => {
  it("writes one line per deposit recorded, with everything needed to trace it", async () => {
    const inv = await invoice();
    const { poller, log } = loggedPoller({ now: new Date() });
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, { tx: "0xabc123" }));
    await poller.tick();

    const [line] = log.find("deposit recorded");
    expect(line).toMatchObject({
      invoiceId: inv.id,
      address: inv.evm,
      tx: "0xabc123",
      fromChain: "base",
      amountIn: "49",
      sender: "buyer",
      invoiceStatus: "PENDING",
      kind: "STANDARD",
    });
    expect(line!.amountInUsd).toBeTruthy();
    expect(line!.depositedAt).toEqual(expect.any(String));
    // Not recorded again on the next poll.
    log.clear();
    await poller.tick();
    expect(log.find("deposit recorded")).toHaveLength(0);
  });

  it("warns, loudly and once, about a deposit from a chain Tender does not list", async () => {
    const inv = await invoice();
    const { poller, log } = loggedPoller({ now: new Date() });
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 20, { fromChain: "hood", tx: "0xhood1" }));
    await poller.tick();

    const [line] = log.find("deposit from a chain Tender does not list");
    expect(line).toMatchObject({ tx: "0xhood1", fromChain: "hood", address: inv.evm });
    expect(line!.level).toBe(WARN);
    expect((await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } })).fromChain).toBe("hood");
    log.clear();
    await poller.tick();
    expect(log.find("deposit from a chain Tender does not list")).toHaveLength(0);
  });

  it("reads the chain from the asset id when Aurora sends none, and flags a deposit with no USD value", async () => {
    const inv = await invoice();
    const { poller, log } = loggedPoller({ now: new Date() });
    const raw = { ...deposit(inv.evm, { asset: ASSETS.UNPRICED, amount: "7913458418732738", tx: "0xnochain" }), fromChain: null, asset_id: "hood.omft.near", decimals: 18 };
    t.aurora.push(inv.evm, "received", raw);
    await poller.tick();

    expect((await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } })).fromChain).toBe("hood");
    expect(log.find("deposit recorded")[0]).toMatchObject({ fromChain: "hood", auroraChain: null, asset: "hood.omft.near", amountIn: "0.007913458418732738" });
    expect(log.find("deposit recorded without a USD value")[0]).toMatchObject({ tx: "0xnochain" });
  });

  it("logs a payout outcome when Aurora reports one", async () => {
    const inv = await invoice();
    const clock = { now: new Date() };
    const { poller, log } = loggedPoller(clock);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    await poller.tick();
    t.aurora.push(inv.evm, "success", deposit(inv.evm, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
    clock.now = new Date(clock.now.getTime() + 10_000);
    await poller.tick();

    expect(log.find("deposit payout outcome recorded")[0]).toMatchObject({ invoiceId: inv.id, outcome: "SETTLED" });
  });

  it("names a deposit Aurora has held without paying out, then repeats only every 15 minutes", async () => {
    const inv = await invoice();
    const clock = { now: new Date() };
    const { poller, log } = loggedPoller(clock);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, { tx: "0xstuck" }));
    await poller.tick();
    const advance = async (minutes: number) => {
      clock.now = new Date(clock.now.getTime() + minutes * 60_000);
      await poller.tick();
    };
    const stuck = () => log.find("deposit received by Aurora but not paid out yet");

    await advance(5);
    expect(stuck()).toHaveLength(0); // not late yet
    await advance(6); // 11 minutes
    expect(stuck()).toHaveLength(1);
    expect(stuck()[0]).toMatchObject({ tx: "0xstuck", invoiceId: inv.id, fromChain: "base" });
    expect(stuck()[0]!.level).toBe(WARN);
    expect(stuck()[0]!.waitingMinutes).toBeGreaterThanOrEqual(10);

    await advance(5); // 16 minutes: inside the 15-minute repeat window
    expect(stuck()).toHaveLength(1);
    await advance(11); // 27 minutes
    expect(stuck()).toHaveLength(2);

    // Once it pays out it is never reported again.
    t.aurora.push(inv.evm, "success", deposit(inv.evm, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
    await advance(1);
    const before = stuck().length;
    await advance(20);
    expect(stuck()).toHaveLength(before);
  });
});

describe("authentication refusals", () => {
  async function guarded() {
    const log = capture();
    const app = Fastify({ logger: { level: "info", stream: log.stream } });
    requireMerchant(app, t.db, "tp_platform_key");
    app.get("/guarded", async () => ({ ok: true }));
    await app.ready();
    return { app, log };
  }

  it("says why a request was refused and never what it carried", async () => {
    const { app, log } = await guarded();
    const secretTail = "ZZsecretTailZZ0123456789";
    const cases: [Record<string, string>, string][] = [
      [{}, "no authorization header"],
      [{ authorization: "Basic abc" }, "malformed authorization header"],
      [{ authorization: `Bearer tk_live_${secretTail}` }, "API key unknown, revoked or wrong"],
      [{ authorization: "Bearer tp_wrong_platform_key", "x-tender-merchant": "mer_1" }, "platform key did not match"],
      [{ authorization: "Bearer tp_platform_key" }, "platform call without a merchant id"],
      [{ authorization: "Bearer tp_platform_key", "x-tender-merchant": "mer_nope" }, "platform call for an unknown merchant"],
    ];
    for (const [headers, reason] of cases) {
      const res = await app.inject({ method: "GET", url: "/guarded?x=1", headers });
      expect(res.statusCode, reason).toBe(401);
    }
    const lines = log.find("authentication refused");
    expect(lines.map((l) => l.reason)).toEqual(cases.map(([, r]) => r));
    for (const l of lines) {
      expect(l.level).toBe(WARN);
      expect(l).toMatchObject({ method: "GET", path: "/guarded" }); // the query string is dropped
      if (l.keyPrefix) expect(String(l.keyPrefix).length).toBeLessThanOrEqual(12);
    }
    const everything = JSON.stringify(log.lines);
    expect(everything).not.toContain(secretTail);
    expect(everything).not.toContain("tp_platform_key");
    await app.close();
  });
});

describe("rate-limit logging", () => {
  it("logs a blocked caller once, not once per blocked request", async () => {
    const log = capture();
    const app = Fastify({ logger: { level: "info", stream: log.stream } });
    await registerRateLimits(app, t.redis);
    app.post("/public/invoices/:token/submit-tx", async () => ({ ok: true }));
    await app.ready();

    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
    const codes: number[] = [];
    for (let i = 0; i < 16; i++) {
      codes.push((await app.inject({ method: "POST", url: "/public/invoices/tok/submit-tx", remoteAddress: ip, payload: {} })).statusCode);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThanOrEqual(5);
    const lines = log.find("rate limit exceeded");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ group: "submit-tx", ip, method: "POST", path: "/public/invoices/tok/submit-tx" });
    await app.close();
  });
});

describe("relayer balance", () => {
  const config = { dailyLimit: 50, maxLines: 10, minRelayerWei: parseEther("0.02") };
  const chainWith = (balance: bigint) =>
    ({ relayerAddress: () => "0xRelayer", relayerBalance: async () => balance, authorizationUsed: async () => false, receipt: async () => null }) as never;

  it("reports a drained relayer as an error, a low one as a warning, and not every minute", async () => {
    const log = capture();
    const clock = { now: new Date("2026-10-12T12:00:00Z") };
    const run = (balance: bigint) => reconcileTransfers({ db: t.db, chain: chainWith(balance), config, logger: log.logger, now: () => clock.now });
    const advance = (ms: number) => (clock.now = new Date(clock.now.getTime() + ms));

    await run(0n);
    const [drained] = log.find("relayer is below its minimum: sends are PAUSED until it is topped up");
    expect(drained).toMatchObject({ relayer: "0xRelayer", balanceMon: 0, minimumMon: 0.02 });
    expect(drained!.level).toBe(ERROR);

    advance(30_000);
    await run(0n);
    expect(log.lines.filter((l) => l.level === ERROR)).toHaveLength(1); // throttled

    advance(120_000);
    await run(parseEther("0.03")); // above the minimum but under twice it
    expect(log.find("relayer balance is low: it will pause sends soon")).toHaveLength(1);

    advance(120_000);
    log.clear();
    await run(parseEther("0.5")); // healthy: silence
    expect(log.lines.filter((l) => l.level >= WARN)).toHaveLength(0);
  });
});

describe("route and account logging", () => {
  it("logs an invoice being created, replayed and cancelled", async () => {
    const m = await merchant(t.db);
    const payload = { amount_expected: "12.50", currency: "USD", reference: "ORD-LOG-1", chains: ["base"] };
    const first = await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload });
    const id = (first.json() as { id: string }).id;
    await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload });
    await t.app.inject({ method: "POST", url: `/v1/invoices/${id}/cancel`, headers: m.auth });

    expect(appLog.find("invoice created")[0]).toMatchObject({ invoiceId: id, merchantId: m.merchant.id, reference: "ORD-LOG-1", amount: "12.5", currency: "USD", created: true });
    expect(appLog.find("invoice create replayed (same reference)")[0]).toMatchObject({ invoiceId: id, created: false });
    expect(appLog.find("invoice cancelled")[0]).toMatchObject({ invoiceId: id, merchantId: m.merchant.id, status: "CANCELLED" });
  });

  it("logs a standing deposit address being created, once", async () => {
    const m = await merchant(t.db);
    const first = await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: m.auth });
    expect(first.statusCode).toBe(201);
    const again = await t.app.inject({ method: "POST", url: "/v1/deposit-address", headers: m.auth });
    expect(again.statusCode).toBe(200);

    const lines = appLog.find("standing deposit address created");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ merchantId: m.merchant.id, settlementAsset: "USDC", depositAddress: (first.json() as { address: string }).address });
  });

  it("audits a settings change without logging a webhook URL's path", async () => {
    const m = await merchant(t.db);
    const res = await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: m.auth, payload: { settlement_asset: "USDT0" } });
    expect(res.statusCode).toBe(200);
    expect(appLog.find("merchant settings updated")[0]).toMatchObject({ merchantId: m.merchant.id, settlementAsset: { from: "USDC", to: "USDT0" }, settlementAddressChanged: false });
  });

  it("logs recovery actions: the request and the result", async () => {
    const m = await merchant(t.db);
    const inv = (
      await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload: { amount_expected: "49.00", currency: "USD", reference: `o_${Math.random()}`, chains: ["base"] } })
    ).json() as { id: string; addresses: { address: string }[] };
    const address = inv.addresses[0]!.address;
    const clock = { now: new Date() };
    const { poller } = loggedPoller(clock);
    t.aurora.push(address, "received", usdc(address, 49));
    t.aurora.push(address, "failed", deposit(address, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
    await poller.tick();
    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });

    appLog.clear();
    const res = await t.app.inject({ method: "POST", url: `/v1/payments/${payment.id}/withdraw`, headers: m.auth, payload: { address: "0x00000000000000000000000000000000000000aa" } });
    expect(res.statusCode).toBeLessThan(300);
    expect(appLog.find("payment recovery requested")[0]).toMatchObject({ merchantId: m.merchant.id, paymentId: payment.id, action: "withdraw" });
    expect(appLog.find("payment withdrawal case prepared")[0]).toMatchObject({ paymentId: payment.id, action: "withdraw" });
  });
});

describe("review follow-ups", () => {
  it("calls a deposit with no named chain 'unknown', not 'a chain Tender does not list'", async () => {
    const inv = await invoice();
    const { poller, log } = loggedPoller({ now: new Date() });
    t.aurora.push(inv.evm, "received", { ...usdc(inv.evm, 5, { tx: "0xnoname" }), fromChain: null });
    await poller.tick();
    expect(log.find("deposit origin chain unknown")[0]).toMatchObject({ tx: "0xnoname", fromChain: "unknown" });
    expect(log.find("deposit from a chain Tender does not list")).toHaveLength(0);
  });

  it("repeats a deposit stuck for over a day only once a day", async () => {
    const inv = await invoice();
    const clock = { now: new Date() };
    const { poller, log } = loggedPoller(clock);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, { tx: "0xold" }));
    await poller.tick();
    const advance = async (minutes: number) => {
      clock.now = new Date(clock.now.getTime() + minutes * 60_000);
      await poller.tick();
    };
    const stuck = () => log.find("deposit received by Aurora but not paid out yet");

    await advance(25 * 60); // 25 hours: reported
    expect(stuck()).toHaveLength(1);
    await advance(60); // an hour later: a day-old stall is not repeated every 15 minutes
    await advance(60);
    expect(stuck()).toHaveLength(1);
    await advance(23 * 60); // a day after the last report
    expect(stuck()).toHaveLength(2);
  });

  it("folds repeated refusals from one caller into one line with a count", async () => {
    const log = capture();
    const app = Fastify({ logger: { level: "info", stream: log.stream } });
    requireMerchant(app, t.db, "tp_platform_key");
    app.get("/guarded", async () => ({ ok: true }));
    await app.ready();
    const ip = `10.77.${Math.floor(Math.random() * 250)}.9`;
    for (let i = 0; i < 6; i++) {
      expect((await app.inject({ method: "GET", url: "/guarded", remoteAddress: ip, headers: { authorization: "Bearer tk_live_nope_nope_nope_nope" } })).statusCode).toBe(401);
    }
    const lines = log.find("authentication refused");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ip, reason: "API key unknown, revoked or wrong", count: 1 });
    await app.close();
  });

  it("logs a payment link being created and an invoice opened from it", async () => {
    const m = await merchant(t.db);
    const link = (await t.app.inject({ method: "POST", url: "/v1/links", headers: m.auth, payload: { label: "Tip jar", amount: "5.00", currency: "USD" } })).json() as { id: string; token: string };
    expect(appLog.find("payment link created")[0]).toMatchObject({ linkId: link.id, merchantId: m.merchant.id, currency: "USD" });

    const opened = await t.app.inject({ method: "POST", url: `/public/links/${link.token}`, payload: {} });
    expect(opened.statusCode).toBe(201);
    const line = appLog.find("invoice created").find((l) => l.via === "payment link");
    expect(line).toMatchObject({ merchantId: m.merchant.id, amount: "5", currency: "USD" });
  });
});

describe("watching past the late window", () => {
  it("still records a payout Aurora makes days after the invoice closed, polling slowly meanwhile", async () => {
    const inv = await invoice();
    const clock = { now: new Date() };
    const { poller } = loggedPoller(clock);
    const advance = async (minutes: number) => {
      clock.now = new Date(clock.now.getTime() + minutes * 60_000);
      await poller.tick();
    };

    // The invoice closes with nothing paid.
    await advance(60);
    expect((await t.db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("EXPIRED");

    // Late money arrives and is recorded, but Aurora does not pay it out.
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49, { tx: "0xlate" }));
    await advance(2);
    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
    expect(payment.status).toBe("DETECTED");

    // Three days on, well past the 24-hour late window: the address is still watched, slowly.
    await advance(3 * 24 * 60);
    const addr = await t.db.invoiceAddress.findFirstOrThrow({ where: { address: inv.evm } });
    const gapMin = (addr.nextPollAt.getTime() - clock.now.getTime()) / 60_000;
    expect(gapMin).toBeGreaterThan(25);
    expect(gapMin).toBeLessThanOrEqual(30);

    // Aurora finally pays out: Tender records it.
    t.aurora.push(inv.evm, "success", deposit(inv.evm, { asset: ASSETS.USDC_MONAD, amount: "48800000" }));
    await advance(31);
    expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("SETTLED");
  });

  it("drops to one poll every 6 hours after a week, and stops after 30 days", async () => {
    const inv = await invoice();
    const clock = { now: new Date() };
    const { poller } = loggedPoller(clock);
    const advance = async (minutes: number) => {
      clock.now = new Date(clock.now.getTime() + minutes * 60_000);
      await poller.tick();
    };
    await advance(60);
    t.aurora.push(inv.evm, "received", usdc(inv.evm, 49));
    await advance(2);

    await advance(8 * 24 * 60); // 8 days
    const at8 = await t.db.invoiceAddress.findFirstOrThrow({ where: { address: inv.evm } });
    expect((at8.nextPollAt.getTime() - clock.now.getTime()) / 3_600_000).toBeCloseTo(6, 0);

    await advance(31 * 24 * 60); // past 30 days: no longer polled
    const before = (await t.db.invoiceAddress.findFirstOrThrow({ where: { address: inv.evm } })).nextPollAt.getTime();
    await advance(7 * 60);
    expect((await t.db.invoiceAddress.findFirstOrThrow({ where: { address: inv.evm } })).nextPollAt.getTime()).toBe(before);
  });
});

describe("log volume", () => {
  it("writes a quiet poller tick only as a heartbeat every 15 minutes", async () => {
    const clock = { now: new Date() };
    const { poller, log } = loggedPoller(clock);
    const infoTicks = () => log.find("poller tick").filter((l) => l.level === 30);
    await poller.tick();
    expect(infoTicks()).toHaveLength(1); // first one is a heartbeat
    for (let i = 0; i < 10; i++) {
      clock.now = new Date(clock.now.getTime() + 10_000);
      await poller.tick();
    }
    expect(infoTicks()).toHaveLength(1);
    clock.now = new Date(clock.now.getTime() + 16 * 60_000);
    await poller.tick();
    expect(infoTicks()).toHaveLength(2);
  });

  it("writes nothing for an ordinary successful request", async () => {
    const m = await merchant(t.db);
    appLog.clear();
    const res = await t.app.inject({ method: "GET", url: "/v1/invoices", headers: m.auth });
    expect(res.statusCode).toBe(200);
    expect(appLog.lines.filter((l) => l.level >= 30)).toEqual([]);
  });
});
