import { describe, expect, test } from "bun:test";
import { formatMoney } from "./money";

// TP-W6-035, TP-W6-028. Money keeps its currency and exponent, and an unknown amount is a dash, never zero.
describe("formatMoney (SKELETONS §6.1, TP-W6-035)", () => {
  test("an unknown amount shows a dash, not zero", () => {
    expect(formatMoney(null)).toBe("—");
  });

  test("shows the currency and the exponent digits with thousands separators", () => {
    expect(formatMoney({ minor: 120410n, currency: "USD", exponent: 2 })).toBe("USD 1,204.10");
    expect(formatMoney({ minor: 0n, currency: "USD", exponent: 2 })).toBe("USD 0.00");
  });

  test("pads small amounts and keeps the sign", () => {
    expect(formatMoney({ minor: 5n, currency: "USD", exponent: 2 })).toBe("USD 0.05");
    expect(formatMoney({ minor: -5n, currency: "USD", exponent: 2 })).toBe("USD -0.05");
  });

  test("respects zero and three-digit minor units", () => {
    expect(formatMoney({ minor: 7n, currency: "JPY", exponent: 0 })).toBe("JPY 7");
    expect(formatMoney({ minor: 1234n, currency: "BHD", exponent: 3 })).toBe("BHD 1.234");
  });
});
