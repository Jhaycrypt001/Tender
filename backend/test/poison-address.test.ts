import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Poller } from "../src/workers/poller.js";
import { ASSETS, deposit, makePoller, merchant, resetDb, setupApp, teardown, type TestContext } from "./helpers.js";

/** One odd entry from Aurora must never blind an address or make it retry forever. */

let t: TestContext;
beforeAll(async () => {
  t = await setupApp();
});
afterAll(() => teardown(t));
beforeEach(async () => {
  await resetDb(t.db);
});

async function invoice() {
  const m = await merchant(t.db);
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/invoices",
    headers: m.auth,
    payload: { amount_expected: "49.00", currency: "USD", reference: `order_${Math.random()}`, chains: ["base"] },
  });
  const inv = res.json() as { id: string; addresses: { chain: string; address: string }[] };
  return { id: inv.id, evm: inv.addresses[0]!.address };
}
const address = (invoiceId: string) => t.db.invoiceAddress.findFirstOrThrow({ where: { invoiceId } });

describe("a poll that hits something unexpected", () => {
  it("records the readable deposit and skips the unreadable ones, and the address keeps moving", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);

    t.aurora.push(inv.evm, "received", deposit(inv.evm, { asset: ASSETS.USDC_BASE, amount: "12.5", tx: "unreadable_amount" }));
    t.aurora.push(inv.evm, "received", deposit(inv.evm, { asset: ASSETS.USDC_BASE, amount: "49000000", tx: "good" }));
    t.aurora.push(inv.evm, "received", { ...deposit(inv.evm, { asset: ASSETS.USDC_BASE, amount: "5000000", tx: "bad_date" }), created_at: "not a date" });
    await poller.tick();

    expect((await t.db.payment.findMany({ where: { invoiceId: inv.id } })).map((p) => p.auroraTxHash)).toEqual(["good"]);
    const a = await address(inv.id);
    expect(a.pollFailures).toBe(0);
    expect(a.nextPollAt.getTime()).toBeGreaterThan(clock.now.getTime());
  });

  it("backs off an address whose poll throws, instead of retrying it every tick", async () => {
    const inv = await invoice();
    const { poller, clock } = makePoller(t);
    const spy = vi.spyOn(Poller.prototype as unknown as { pollAddress: () => Promise<number> }, "pollAddress").mockRejectedValueOnce(new Error("boom"));

    await poller.tick();
    const a = await address(inv.id);
    expect(a.pollFailures).toBe(1);
    expect(a.nextPollAt.getTime()).toBeGreaterThan(clock.now.getTime());

    // Not due again straight away: it is not hammered every tick.
    await poller.tick();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
