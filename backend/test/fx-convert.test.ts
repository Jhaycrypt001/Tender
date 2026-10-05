import { describe, expect, it } from "vitest";
import { convertUsd, displayDecimals, isUsdPegged } from "../../frontend/src/lib/fx.js";

describe("convertUsd (frontend display conversion)", () => {
  it("multiplies exactly, with no float rounding", () => {
    expect(convertUsd("100", "0.88889", 2)).toBe("88.88");
    expect(convertUsd("1", "1331.279356", 2)).toBe("1331.27");
    expect(convertUsd("0.1", "3", 2)).toBe("0.30");
    expect(convertUsd("123456789.12", "1.5", 2)).toBe("185185183.68");
  });

  it("truncates toward zero and never rounds up", () => {
    expect(convertUsd("1", "0.999999", 2)).toBe("0.99");
    expect(convertUsd("49.00", "157.730309", 0)).toBe("7728");
  });

  it("keeps 18-decimal amounts intact instead of passing through a float", () => {
    expect(convertUsd("0.000000000000000001", "2", 18)).toBe("0.000000000000000002");
    expect(convertUsd("1234567890123456789.123456789012345678", "1", 2)).toBe("1234567890123456789.12");
  });

  it("handles zero, negatives and padding", () => {
    expect(convertUsd("0", "5", 2)).toBe("0.00");
    expect(convertUsd("-10", "0.9", 2)).toBe("-9.00");
    expect(convertUsd("0.05", "0.5", 2)).toBe("0.02");
  });

  it("refuses a bad amount or rate rather than showing a wrong number", () => {
    expect(convertUsd("abc", "1", 2)).toBeNull();
    expect(convertUsd("1", "0", 2)).toBeNull();
    expect(convertUsd("1", "-2", 2)).toBeNull();
    expect(convertUsd("1", "", 2)).toBeNull();
  });

  it("converts only dollar-valued assets", () => {
    for (const ok of ["USD", "USDC", "usdt0", "USDT"]) expect(isUsdPegged(ok)).toBe(true);
    for (const no of ["MON", "BTC", "ETH", "", undefined]) expect(isUsdPegged(no)).toBe(false);
    expect(displayDecimals("JPY")).toBe(0);
    expect(displayDecimals("EUR")).toBe(2);
  });
});
