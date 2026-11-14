import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** A failed payout must not be pinned on a deposit it may not belong to. */

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

async function invoiceWithTwoDeposits() {
  const m = await merchant(t.db);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: "49.00", currency: "USD", reference: `order_${Math.random()}`, chains: ["base"] },
  });
  const inv = res.json() as { id: string; addresses: { address: string }[] };
  const evm = inv.addresses[0]!.address;
  const now = Date.now();
  t.aurora.push(evm, "received", deposit(evm, { asset: ASSETS.USDC_BASE, amount: "10000000", tx: "deposit_a", at: new Date(now - 60_000) }));
  t.aurora.push(evm, "received", deposit(evm, { asset: ASSETS.USDC_BASE, amount: "12000000", tx: "deposit_b", at: new Date(now - 30_000) }));
  return { id: inv.id, evm };
}

describe("a failed payout that could belong to either of two waiting deposits", () => {
  it("is left alone, not pinned on the oldest one with a recovery task and a webhook", async () => {
    const inv = await invoiceWithTwoDeposits();
    // $50 fits neither deposit ($10, $12), and Aurora names no deposit: nothing says which one failed.
    t.aurora.push(inv.evm, "failed", deposit(inv.evm, { asset: ASSETS.USDC_MONAD, amount: "50000000", tx: "failed_payout" }));
    await makePoller(t).poller.tick();

    const payments = await t.db.payment.findMany({ where: { invoiceId: inv.id }, orderBy: { firstSeenAt: "asc" } });
    expect(payments.map((p) => [p.auroraTxHash, p.status])).toEqual([["deposit_a", "DETECTED"], ["deposit_b", "DETECTED"]]);
    expect(await t.db.recoveryTask.count()).toBe(0);
  });
});
