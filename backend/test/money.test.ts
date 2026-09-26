import { describe, expect, it } from "vitest";
import { coverage, fromBaseUnits, isAmount } from "../src/lib/money.js";

describe("coverage", () => {
  it("judges exact, under and over", () => {
    expect(coverage("49.00", "49")).toBe("EXACT");
    expect(coverage("48.99", "49.00")).toBe("UNDER");
    expect(coverage("49.01", "49.00")).toBe("OVER");
  });

  it("is exact at 18 decimals, where a float would not be", () => {
    const expected = "1.000000000000000001";
    expect(coverage("1.000000000000000001", expected)).toBe("EXACT");
    expect(coverage("1.000000000000000000", expected)).toBe("UNDER");
    expect(coverage("1.000000000000000002", expected)).toBe("OVER");
    // The float version gets this wrong: both sides round to 1.
    expect(Number("1.000000000000000001") === Number("1")).toBe(true);
  });

  it("handles large token amounts without precision loss", () => {
    expect(coverage("123456789012345678.123456789012345678", "123456789012345678.123456789012345677")).toBe("OVER");
  });
});

describe("fromBaseUnits", () => {
  it("converts USDC (6dp) and MON (18dp)", () => {
    expect(fromBaseUnits("49000000", 6)).toBe("49");
    expect(fromBaseUnits("1", 6)).toBe("0.000001");
    expect(fromBaseUnits("1000000000000000001", 18)).toBe("1.000000000000000001");
  });

  it("rejects anything that is not a base-unit integer", () => {
    expect(() => fromBaseUnits("1.5", 6)).toThrow();
    expect(() => fromBaseUnits("-1", 6)).toThrow();
  });
});

describe("isAmount", () => {
  it("accepts decimal strings and rejects everything else", () => {
    for (const ok of ["0", "49", "49.00", "0.000461", "1.123456789012345678"]) expect(isAmount(ok)).toBe(true);
    for (const bad of ["", "-1", "01", "1.", ".5", "1e3", "1.1234567890123456789", "NaN"]) expect(isAmount(bad)).toBe(false);
  });
});
