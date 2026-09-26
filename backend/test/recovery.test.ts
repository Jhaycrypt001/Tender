import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as S from "../contract/schemas.js";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
  await t.redis.flushdb();
});

const usdc = (address: string, dollars: number) =>
  deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)) });
const payout = (address: string, dollars: number) =>
  deposit(address, { asset: ASSETS.USDC_MONAD, amount: String(Math.round(dollars * 1e6)) });

/** An invoice whose $49 deposit landed and then failed onward. */
async function failedPayment() {
  const m = await merchant(t.db);
  const inv = (
    await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: m.auth,
      payload: { amount_expected: "49.00", currency: "USD", reference: `o_${Math.random()}`, chains: ["base"] },
    })
  ).json() as { id: string; addresses: { address: string }[] };
  const address = inv.addresses[0]!.address;
  const { poller, clock } = makePoller(t);
  t.aurora.push(address, "received", usdc(address, 49));
  t.aurora.push(address, "failed", payout(address, 48.8));
  await poller.tick();
  const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });
  return { m, inv, address, payment, poller, clock };
}

describe("payments API", () => {
  it("lists and details payments in the contract shape, scoped to the merchant", async () => {
    const { m, payment } = await failedPayment();
    const other = await merchant(t.db);

    const list = await t.app.inject({ method: "GET", url: "/v1/payments", headers: m.auth });
    expect(S.paginated(S.Payment).parse(list.json()).data.map((p) => p.id)).toEqual([payment.id]);

    const detail = await t.app.inject({ method: "GET", url: `/v1/payments/${payment.id}`, headers: m.auth });
    const body = S.PaymentDetail.parse(detail.json());
    expect(body.invoice.status).toBe("NEEDS_RECOVERY");
    expect(body.recovery).toMatchObject({ state: "OPEN" });
    expect(body.history.map((h) => h.status)).toEqual(["DETECTED", "FAILED"]);

    const foreign = await t.app.inject({ method: "GET", url: `/v1/payments/${payment.id}`, headers: other.auth });
    expect(foreign.statusCode).toBe(404);
  });

  it("filters by payment status", async () => {
    const { m } = await failedPayment();
    const settled = await t.app.inject({ method: "GET", url: "/v1/payments?status=SETTLED", headers: m.auth });
    expect(settled.json().data).toHaveLength(0);
    const failed = await t.app.inject({ method: "GET", url: "/v1/payments?status=FAILED", headers: m.auth });
    expect(failed.json().data).toHaveLength(1);
  });
});

describe("NEEDS_RECOVERY actions", () => {
  it("retry re-checks Aurora, and a payout Aurora completes later resolves the task", async () => {
    const { m, address, payment, poller, clock } = await failedPayment();

    const res = await t.app.inject({ method: "POST", url: `/v1/payments/${payment.id}/retry`, headers: m.auth });
    expect(S.PaymentDetail.parse(res.json()).recovery?.state).toBe("RETRYING");

    // Aurora completes the payout on its side.
    t.aurora.push(address, "success", payout(address, 48.8));
    clock.now = new Date(clock.now.getTime() + 1000);
    await poller.tick();

    const after = await t.app.inject({ method: "GET", url: `/v1/payments/${payment.id}`, headers: m.auth });
    const body = S.PaymentDetail.parse(after.json());
    expect(body.status).toBe("SETTLED");
    expect(body.amount_settled).toBe("48.80");
    expect(body.recovery?.state).toBe("RESOLVED");
    // The invoice stays NEEDS_RECOVERY: terminal states never move.
    expect(body.invoice.status).toBe("NEEDS_RECOVERY");

    // A resolved task cannot be retried again.
    const again = await t.app.inject({ method: "POST", url: `/v1/payments/${payment.id}/retry`, headers: m.auth });
    expect(again.statusCode).toBe(409);
  });

  it("keeps re-polling an address with an open recovery, but never re-processes the old failure", async () => {
    const { payment, poller, clock } = await failedPayment();
    for (let i = 0; i < 3; i++) {
      clock.now = new Date(clock.now.getTime() + 10_000);
      await poller.tick();
    }
    expect(await t.db.recoveryTask.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await t.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("FAILED");
  });

  it("withdraw records a support case and never claims the funds moved", async () => {
    const { m, payment, address } = await failedPayment();
    const res = await t.app.inject({
      method: "POST",
      url: `/v1/payments/${payment.id}/withdraw`,
      headers: m.auth,
      payload: { address: "0x1111111111111111111111111111111111111111" },
    });
    const body = S.PaymentDetail.parse(res.json());
    expect(body.recovery?.state).toBe("OPEN");
    expect(body.recovery?.notes).toContain("https://aurora.dev/intents-support");
    expect(body.recovery?.notes).toContain(payment.auroraTxHash);
    expect(body.recovery?.notes).toContain(address);
    expect(body.recovery?.notes).toContain("0x1111111111111111111111111111111111111111");

    const bad = await t.app.inject({ method: "POST", url: `/v1/payments/${payment.id}/withdraw`, headers: m.auth, payload: { address: "nope" } });
    expect(bad.statusCode).toBe(400);
  });

  it("refuses retry/withdraw on a payment that never failed, and refund everywhere", async () => {
    const m = await merchant(t.db);
    const inv = (
      await t.app.inject({
        method: "POST",
        url: "/v1/invoices",
        headers: m.auth,
        payload: { amount_expected: "49.00", currency: "USD", reference: "ok", chains: ["base"] },
      })
    ).json() as { id: string; addresses: { address: string }[] };
    const address = inv.addresses[0]!.address;
    const { poller } = makePoller(t);
    t.aurora.push(address, "received", usdc(address, 49));
    t.aurora.push(address, "success", payout(address, 48.8));
    await poller.tick();
    const payment = await t.db.payment.findFirstOrThrow({ where: { invoiceId: inv.id } });

    const retry = await t.app.inject({ method: "POST", url: `/v1/payments/${payment.id}/retry`, headers: m.auth });
    expect(retry.statusCode).toBe(409);
    const refund = await t.app.inject({ method: "POST", url: `/v1/payments/${payment.id}/refund`, headers: m.auth });
    expect(refund.statusCode).toBe(501);
    expect(refund.json().error).toBe("not_supported");
  });
});

describe("settlement address proof", () => {
  it("unlocks invoicing only after the wallet signs the challenge", async () => {
    const wallet = privateKeyToAccount(generatePrivateKey());
    const m = await merchant(t.db, { verified: false });

    const patch = await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: m.auth, payload: { settlement_address: wallet.address } });
    expect(patch.json()).toMatchObject({ settlement_address: wallet.address, settlement_verified: false });

    const blocked = await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: m.auth,
      payload: { amount_expected: "1.00", currency: "USD", reference: "r1" },
    });
    expect(blocked.json().error).toBe("settlement_not_verified");

    const challenge = S.SettlementChallenge.parse(
      (await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/challenge", headers: m.auth })).json(),
    );
    expect(challenge.message).toContain(wallet.address);
    expect(challenge.message).toContain(m.merchant.id);

    const signature = await wallet.signMessage({ message: challenge.message });
    const verify = await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/verify", headers: m.auth, payload: { signature } });
    expect(verify.json()).toMatchObject({ settlement_verified: true });

    // Single use: the same signature cannot be replayed.
    const replay = await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/verify", headers: m.auth, payload: { signature } });
    expect(replay.statusCode).toBe(400);

    const ok = await t.app.inject({
      method: "POST",
      url: "/v1/invoices",
      headers: m.auth,
      payload: { amount_expected: "1.00", currency: "USD", reference: "r1" },
    });
    expect(ok.statusCode).toBe(201);
  });

  it("rejects a signature from any other wallet", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const attacker = privateKeyToAccount(generatePrivateKey());
    const m = await merchant(t.db, { verified: false });
    await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: m.auth, payload: { settlement_address: owner.address } });

    const { message } = (await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/challenge", headers: m.auth })).json();
    const signature = await attacker.signMessage({ message });
    const res = await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/verify", headers: m.auth, payload: { signature } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_signature");
  });

  it("changing the address un-verifies it and voids an outstanding challenge", async () => {
    const first = privateKeyToAccount(generatePrivateKey());
    const second = privateKeyToAccount(generatePrivateKey());
    const m = await merchant(t.db, { verified: false });
    await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: m.auth, payload: { settlement_address: first.address } });
    const { message } = (await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/challenge", headers: m.auth })).json();

    // A stolen session swaps the address before the owner signs.
    await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: m.auth, payload: { settlement_address: second.address } });
    const signature = await first.signMessage({ message });
    const res = await t.app.inject({ method: "POST", url: "/v1/merchant/settlement/verify", headers: m.auth, payload: { signature } });
    expect(res.json().error).toBe("address_changed");

    // And a verified merchant who changes address is un-verified.
    const verified = await merchant(t.db);
    const changed = await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: verified.auth, payload: { settlement_address: second.address } });
    expect(changed.json().settlement_verified).toBe(false);
  });

  it("validates settings", async () => {
    const m = await merchant(t.db);
    const cases: Array<[object, string]> = [
      [{ settlement_address: "0x123" }, "settlement_address"],
      [{ settlement_asset: "DOGE" }, "settlement_asset"],
      [{ webhook_url: "http://example.com/hooks" }, "webhook_url"],
      [{ webhook_url: "https://127.0.0.1/hooks" }, "webhook_url"],
    ];
    for (const [payload, field] of cases) {
      const res = await t.app.inject({ method: "PATCH", url: "/v1/merchant", headers: m.auth, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(Object.keys(res.json().fields)).toContain(field);
    }
  });
});
