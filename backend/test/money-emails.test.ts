import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";
import { EmailWorker } from "../src/workers/email.worker.js";
import { renderMoneyIn, renderMoneyOut, renderWelcome } from "../src/services/email.service.js";
import { createLogger } from "../src/lib/logger.js";

const cfg = { apiKey: "re_test", from: "Tender <hello@tenderr.xyz>", appUrl: "https://tenderr.xyz" };
type Send = NonNullable<ConstructorParameters<typeof EmailWorker>[0]["send"]>;

let t: TestContext;
beforeAll(async () => {
  t = await setupApp({ RESEND_API_KEY: "re_test" });
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

const worker = (send: Send, now: Date) => new EmailWorker({ db: t.db, logger: createLogger("fatal", false), config: cfg, send, now: () => now });
const ok: Send = async () => ({ ok: true });
const usdc = (address: string, dollars: number, tx: string, at: Date) =>
  deposit(address, { asset: ASSETS.USDC_BASE, amount: String(Math.round(dollars * 1e6)), tx, at });
const payout = (address: string, dollars: number, tx: string, at: Date) =>
  deposit(address, { asset: ASSETS.USDC_MONAD, amount: String(Math.round(dollars * 1e6)), tx, at });

/** A $5 invoice for a fresh merchant. */
async function invoice(opts: { payIn?: boolean } = {}) {
  const m = await merchant(t.db);
  if (opts.payIn === false) await t.db.merchant.update({ where: { id: m.merchant.id }, data: { emailPayIn: false } });
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: "5.00", currency: "USD", reference: "ORD-T", chains: ["base"] },
  });
  const inv = res.json() as { id: string; addresses: { chain: string; address: string }[] };
  return { m: m.merchant, inv, evm: inv.addresses[0]!.address };
}

describe("money in", () => {
  it("emails each settled payment once: part payment, then paid in full after the top-up", async () => {
    const { m, inv, evm } = await invoice();
    const clock = { now: new Date() };
    const { poller } = makePoller(t, clock);
    const send = vi.fn(ok);

    t.aurora.push(evm, "received", usdc(evm, 2, "first", clock.now));
    t.aurora.push(evm, "success", payout(evm, 1.99, "out1", clock.now));
    await poller.tick();
    expect(await worker(send, clock.now).sweep()).toBe(1);
    await worker(send, clock.now).tick();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBe(m.email);
    expect(send.mock.calls[0]![1].subject).toBe("$2.00 of $5.00 received · ORD-T");

    // The sweep is once-only: nothing new, nothing queued.
    expect(await worker(send, clock.now).sweep()).toBe(0);

    clock.now = new Date(clock.now.getTime() + 60_000);
    t.aurora.push(evm, "received", usdc(evm, 3, "second", clock.now));
    t.aurora.push(evm, "success", payout(evm, 2.98, "out2", clock.now));
    await poller.tick();
    expect(await worker(send, clock.now).sweep()).toBe(1);
    await worker(send, clock.now).tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![1].subject).toBe("Received $2.98 · ORD-T");
    expect(send.mock.calls[1]![1].html).toContain("Paid in full");
    expect(inv.id).toBeTruthy();
  });

  it("sends nothing to a merchant who turned payment emails off", async () => {
    const { inv, evm } = await invoice({ payIn: false });
    const clock = { now: new Date() };
    const { poller } = makePoller(t, clock);
    t.aurora.push(evm, "received", usdc(evm, 5, "p", clock.now));
    t.aurora.push(evm, "success", payout(evm, 4.98, "o", clock.now));
    await poller.tick();
    expect(await worker(vi.fn(ok), clock.now).sweep()).toBe(0);
    expect(inv.id).toBeTruthy();
  });

  it("skips a queued email if the merchant turns them off before it is sent", async () => {
    const { m, evm } = await invoice();
    const clock = { now: new Date() };
    const { poller } = makePoller(t, clock);
    t.aurora.push(evm, "received", usdc(evm, 5, "p", clock.now));
    t.aurora.push(evm, "success", payout(evm, 4.98, "o", clock.now));
    await poller.tick();
    const send = vi.fn(ok);
    await worker(send, clock.now).sweep();
    await t.db.merchant.update({ where: { id: m.id }, data: { emailPayIn: false } });
    await worker(send, clock.now).tick();
    expect(send).not.toHaveBeenCalled();
    expect((await t.db.emailDelivery.findFirstOrThrow()).lastError).toContain("skipped");
  });

  it("emails once when an invoice closes short, and says how much", async () => {
    const { evm } = await invoice();
    const clock = { now: new Date() };
    const { poller } = makePoller(t, clock);
    t.aurora.push(evm, "received", usdc(evm, 2, "p", clock.now));
    t.aurora.push(evm, "success", payout(evm, 1.99, "o", clock.now));
    await poller.tick();
    clock.now = new Date(clock.now.getTime() + 60 * 60_000);
    await poller.tick();
    const send = vi.fn(ok);
    await worker(send, clock.now).sweep();
    await worker(send, clock.now).tick();
    const subjects = send.mock.calls.map((c) => c[1].subject);
    expect(subjects).toContain("ORD-T closed $3.00 short");
  });
});

describe("money out", () => {
  const transfer = async (merchantId: string, over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) =>
    t.db.transfer.create({
      data: {
        merchantId,
        kind: "REFUND",
        status: "CONFIRMED",
        asset: "USDC",
        fromAddress: "0x88A7a4fFDDe961AF79582da333594e1Aa1c411F0",
        totalAmount: "4.99",
        expiresAt: new Date(Date.now() + 3_600_000),
        confirmedAt: new Date(),
        submittedAt: new Date(),
        lines: { create: [{ index: 0, toAddress: "0x1111111111111111111111111111111111111111", amount: "4.99", nonce: `0x${"1".repeat(64)}`, ...line }] },
        ...over,
      } as never,
    });

  it("emails a confirmed transfer once, always, and names what it was", async () => {
    const { m } = await invoice({ payIn: false });
    const tr = await transfer(m.id);
    const send = vi.fn(ok);
    const now = new Date();
    expect(await worker(send, now).sweep()).toBe(1);
    expect(await worker(send, now).sweep()).toBe(0);
    await worker(send, now).tick();
    expect(send.mock.calls[0]![1].subject).toBe("Refund sent · $4.99");
    expect(send.mock.calls[0]![1].html).toContain(`/app/activity/sent/${tr.id}`);
  });

  it("waits for a cross-chain leg to arrive, and says so if it never does", async () => {
    const { m } = await invoice();
    const tr = await transfer(m.id, {}, { destChain: "base", destAddress: "0x2222222222222222222222222222222222222222", destAsset: "USDC", destStatus: "PENDING" });
    const send = vi.fn(ok);
    const now = new Date();
    expect(await worker(send, now).sweep()).toBe(0); // still on its way: nothing to say yet

    await t.db.transferLine.updateMany({ where: { transferId: tr.id }, data: { destStatus: "FAILED" } });
    expect(await worker(send, now).sweep()).toBe(1);
    await worker(send, now).tick();
    expect(send.mock.calls[0]![1].subject).toBe("Refund not delivered · $4.99");
    expect(send.mock.calls[0]![1].html).toContain("did not reach Base");
  });

  it("emails a transfer the network refused after it was submitted, not one that merely expired unsigned", async () => {
    const { m } = await invoice();
    await transfer(m.id, { status: "FAILED", confirmedAt: null, txHash: `0x${"9".repeat(64)}`, failureReason: "The transaction failed on the network, so no money moved." });
    // Refused before it was broadcast: nothing moved and the screen said so. No email.
    await transfer(m.id, { status: "FAILED", confirmedAt: null, failureReason: "The network refused it, so nothing was sent.", lines: { create: [{ index: 0, toAddress: "0x4444444444444444444444444444444444444444", amount: "2", nonce: `0x${"4".repeat(64)}` }] } });
    await transfer(m.id, { status: "EXPIRED", confirmedAt: null, submittedAt: null, lines: { create: [{ index: 0, toAddress: "0x3333333333333333333333333333333333333333", amount: "1", nonce: `0x${"2".repeat(64)}` }] } });
    const send = vi.fn(ok);
    const now = new Date();
    expect(await worker(send, now).sweep()).toBe(1);
    await worker(send, now).tick();
    expect(send.mock.calls[0]![1].subject).toBe("Refund not delivered · $4.99");
    expect(send.mock.calls[0]![1].html).toContain("no money moved");
  });
});

describe("the layout", () => {
  const appUrl = "https://tenderr.xyz";
  const at = new Date("2026-10-13T14:35:11Z");
  const base = { appUrl, at, currency: "USD", fromChain: "Base", reference: "ORD-9", invoiceId: "inv_1" };

  it("carries the mark and one large figure in every email", () => {
    const all = [
      renderWelcome({ id: "x", name: "A", settlementAddress: null, settlementVerified: false, appUrl }),
      renderMoneyIn({ ...base, variant: "received", amount: "49.00" }),
      renderMoneyIn({ ...base, variant: "partial", amount: "1.99", received: "1.99", expected: "5.00" }),
      renderMoneyIn({ ...base, variant: "over", amount: "15", received: "14.99", expected: "10" }),
      renderMoneyIn({ ...base, variant: "short", amount: "1.99", received: "1.99", expected: "5.00" }),
      renderMoneyIn({ ...base, variant: "deposit", amount: "19.85" }),
      renderMoneyOut({ appUrl, at, variant: "sent", transferId: "t", kind: "SPLIT", amount: "10", asset: "USDC", to: [{ address: "0x" + "a".repeat(40), chain: "Monad" }] }),
      renderMoneyOut({ appUrl, at, variant: "failed", transferId: "t", kind: "PAYOUT", amount: "10", asset: "USDC", to: [{ address: "0x" + "a".repeat(40), chain: "Base" }] }),
    ];
    for (const m of all) {
      expect(m.html).toContain(`<img src="${appUrl}/apple-icon.png"`);
      expect(m.html).toMatch(/font-size:(28|36|48)px/);
      expect(m.subject.length).toBeGreaterThan(5);
    }
  });

  it("escapes a hostile invoice reference", () => {
    const m = renderMoneyIn({ ...base, reference: `<img src=x onerror=alert(1)>`, variant: "received", amount: "1" });
    expect(m.html).not.toContain("<img src=x");
    expect(m.html).toContain("&lt;img");
  });

  it("formats dollars with separators and two decimals", () => {
    expect(renderMoneyIn({ ...base, variant: "received", amount: "12345.5" }).subject).toBe("Received $12,345.50 · ORD-9");
  });
});

describe("what the emails say", () => {
  it("never says $0.00 short: it uses the page's rounded-down total", async () => {
    const m = await merchant(t.db);
    const inv = await t.db.invoice.findUniqueOrThrow({
      where: {
        id: (
          await t.app.inject({ method: "POST", url: "/v1/invoices", headers: m.auth, payload: { amount_expected: "5.00", currency: "USD", reference: "ORD-R", chains: ["base"] } })
        ).json().id,
      },
      include: { addresses: true },
    });
    for (const [i, usd] of ["0.997197", "4.00"].entries()) {
      await t.db.payment.create({
        data: { invoiceId: inv.id, invoiceAddressId: inv.addresses[0]!.id, auroraTxHash: `r${i}`, fromChain: "base", amountIn: usd, amountInUsd: usd, status: "SETTLED", settledAt: new Date(), raw: {} },
      });
    }
    await t.db.invoice.update({ where: { id: inv.id }, data: { status: "UNDERPAID" } });
    const send = vi.fn(ok);
    const now = new Date();
    await worker(send, now).sweep();
    await worker(send, now).tick();
    const subjects = send.mock.calls.map((c) => c[1].subject);
    expect(subjects).toContain("ORD-R closed $0.01 short");
    // Its two payments settled before the email went out, but only the one closed-short email is sent.
    expect(send).toHaveBeenCalledTimes(1);
    expect(subjects.join(" ")).not.toContain("$0.00");
  });

  const appUrl = "https://tenderr.xyz";
  const at = new Date("2026-10-13T14:35:11Z");

  it("puts the time in UTC on every money email", () => {
    const m = renderMoneyIn({ appUrl, at, currency: "USD", fromChain: "Base", reference: "ORD-9", invoiceId: "i", variant: "received", amount: "5" });
    expect(m.html).toContain("13 Oct, 14:35 UTC");
    expect(m.text).toContain("When: 13 Oct, 14:35 UTC");
  });

  it("tells a new merchant what Tender is and shows their merchant ID", () => {
    const m = renderWelcome({ id: "cmv0x7yf300020flnm1plvnp6", name: "Ada", settlementAddress: null, settlementVerified: false, appUrl });
    expect(m.html).toContain("cmv0x7yf300020flnm1plvnp6");
    expect(m.text).toContain("Merchant ID: cmv0x7yf300020flnm1plvnp6");
    expect(m.html).toContain("USDC lands in your own wallet on Monad");
    expect(m.text).toContain("- No wallet connect");
  });
});
