import { describe, expect, it } from "vitest";
import { judge, matchOutcomes, type JudgeInput, type PaymentView } from "../src/services/settlement.js";

const base: JudgeInput = { status: "PENDING", amountExpected: "49.00", payments: [], closed: false, toleranceBps: 100 };
const p = (status: PaymentView["status"], usd: string | null): PaymentView => ({ status, amountInUsd: usd });
const j = (over: Partial<JudgeInput>) => judge({ ...base, ...over });

describe("judge", () => {
  it("stays PENDING with nothing received, and EXPIRES once closed", () => {
    expect(j({})).toBe("PENDING");
    expect(j({ closed: true })).toBe("EXPIRED");
  });

  it("is DETECTED while a deposit is in flight", () => {
    expect(j({ payments: [p("DETECTED", "49")] })).toBe("DETECTED");
    // Still in flight when the window closes: wait, never guess.
    expect(j({ payments: [p("DETECTED", "49")], closed: true, status: "DETECTED" })).toBe("DETECTED");
  });

  it("SETTLES on a settled payment that covers the amount, within tolerance", () => {
    expect(j({ payments: [p("SETTLED", "49.00")] })).toBe("SETTLED");
    expect(j({ payments: [p("SETTLED", "48.52")] })).toBe("SETTLED"); // −0.98%
    expect(j({ payments: [p("SETTLED", "49.48")] })).toBe("SETTLED"); // +0.98%
  });

  it("is OVERPAID above the tolerance, or when a second payment arrives", () => {
    expect(j({ payments: [p("SETTLED", "49.50")] })).toBe("OVERPAID");
    expect(j({ payments: [p("SETTLED", "49"), p("DETECTED", "5")] })).toBe("OVERPAID");
  });

  it("turns SETTLED into OVERPAID on a later payment — the one published exception to terminality", () => {
    expect(j({ status: "SETTLED", payments: [p("SETTLED", "49")] })).toBe("SETTLED");
    expect(j({ status: "SETTLED", payments: [p("SETTLED", "49"), p("DETECTED", "10")] })).toBe("OVERPAID");
  });

  it("never sums partial payments into a settlement", () => {
    const halves = [p("SETTLED", "24.50"), p("SETTLED", "24.50")];
    expect(j({ status: "DETECTED", payments: halves })).toBe("DETECTED");
    expect(j({ status: "DETECTED", payments: halves, closed: true })).toBe("UNDERPAID");
  });

  it("is UNDERPAID only once closed and fully resolved", () => {
    expect(j({ status: "DETECTED", payments: [p("SETTLED", "20")] })).toBe("DETECTED");
    expect(j({ status: "DETECTED", payments: [p("SETTLED", "20")], closed: true })).toBe("UNDERPAID");
    expect(j({ status: "DETECTED", payments: [p("SETTLED", "20"), p("DETECTED", "29")], closed: true })).toBe("DETECTED");
  });

  it("goes to NEEDS_RECOVERY when a received deposit fails onward", () => {
    expect(j({ status: "DETECTED", payments: [p("FAILED", "49")] })).toBe("NEEDS_RECOVERY");
  });

  it("does not settle a payment it cannot value", () => {
    expect(j({ status: "DETECTED", payments: [p("SETTLED", null)] })).toBe("DETECTED");
  });

  it("never moves other terminal states", () => {
    for (const status of ["OVERPAID", "UNDERPAID", "EXPIRED", "CANCELLED", "NEEDS_RECOVERY"] as const) {
      expect(j({ status, payments: [p("SETTLED", "49"), p("FAILED", "1")], closed: true })).toBe(status);
    }
  });
});

describe("matchOutcomes", () => {
  const open = [
    { id: "p2", auroraTxHash: "in2", firstSeenAt: new Date("2026-01-01T00:02:00Z") },
    { id: "p1", auroraTxHash: "in1", firstSeenAt: new Date("2026-01-01T00:01:00Z") },
  ];
  const out = (tx_hash: string, minute: number) => ({ tx_hash, created_at: `2026-01-01T00:0${minute}:30Z` });

  it("matches on a shared tx hash first", () => {
    const { pairs } = matchOutcomes(open, [out("in2", 3)]);
    expect(pairs).toEqual([{ paymentId: "p2", outcome: out("in2", 3) }]);
  });

  it("otherwise pairs outcomes with deposits in chronological order", () => {
    const { pairs } = matchOutcomes(open, [out("payout_b", 4), out("payout_a", 3)]);
    expect(pairs.map((x) => [x.paymentId, x.outcome.tx_hash])).toEqual([
      ["p1", "payout_a"],
      ["p2", "payout_b"],
    ]);
  });

  it("matches on value when deposits wait at the same time, not just on age", () => {
    // A slow 40-dollar deposit arrives first, then a fast 5-dollar one, which is paid out first.
    const waiting = [
      { id: "slow", auroraTxHash: "in_slow", firstSeenAt: new Date("2026-01-01T00:01:00Z"), amountInUsd: "40" },
      { id: "fast", auroraTxHash: "in_fast", firstSeenAt: new Date("2026-01-01T00:02:00Z"), amountInUsd: "5" },
    ];
    const paid = (tx_hash: string, minute: number, dollars: string) => ({
      ...out(tx_hash, minute),
      amount: String(Math.round(Number(dollars) * 1e6)),
      decimals: 6,
    });
    const { pairs } = matchOutcomes(waiting, [paid("payout_fast", 3, "4.98"), paid("payout_slow", 9, "39.9")]);
    expect(pairs.map((x) => [x.paymentId, x.outcome.tx_hash])).toEqual([
      ["fast", "payout_fast"],
      ["slow", "payout_slow"],
    ]);
  });

  it("never gives a payout to a deposit worth less than it, or one that arrived after it", () => {
    const waiting = [
      { id: "small", auroraTxHash: "a", firstSeenAt: new Date("2026-01-01T00:01:00Z"), amountInUsd: "1" },
      { id: "later", auroraTxHash: "b", firstSeenAt: new Date("2026-01-01T00:08:00Z"), amountInUsd: "20" },
      { id: "right", auroraTxHash: "c", firstSeenAt: new Date("2026-01-01T00:02:00Z"), amountInUsd: "25" },
    ];
    const { pairs } = matchOutcomes(waiting, [{ ...out("p", 5), amount: "19900000", decimals: 6 }]);
    expect(pairs.map((x) => x.paymentId)).toEqual(["right"]);
  });

  it("falls back to the oldest deposit when values cannot decide", () => {
    const waiting = [
      { id: "old", auroraTxHash: "a", firstSeenAt: new Date("2026-01-01T00:01:00Z"), amountInUsd: null },
      { id: "new", auroraTxHash: "b", firstSeenAt: new Date("2026-01-01T00:02:00Z"), amountInUsd: null },
    ];
    const { pairs } = matchOutcomes(waiting, [{ ...out("p", 5), amount: "1000000", decimals: 6 }]);
    expect(pairs.map((x) => x.paymentId)).toEqual(["old"]);
  });

  it("reports outcomes with no deposit left as orphans", () => {
    const { pairs, orphans } = matchOutcomes([open[1]!], [out("a", 3), out("b", 4)]);
    expect(pairs).toHaveLength(1);
    expect(orphans.map((o) => o.tx_hash)).toEqual(["b"]);
  });
});
