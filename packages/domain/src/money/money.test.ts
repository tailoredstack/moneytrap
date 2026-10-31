import { describe, expect, test } from "bun:test";
import { Money, parseMoney } from "./money";

describe("Money", () => {
  test("TP-W1-001 formats minor units as a decimal string", () => {
    expect(Money.of(12537n, "USD").format()).toBe("125.37");
  });

  test("TP-W1-002 parse requires the exact fraction width", () => {
    const ok = parseMoney("125.37", "USD");
    expect(ok.ok && ok.value.amount).toBe(12537n);
    const bad = parseMoney("125.3x", "USD");
    expect(bad.ok).toBe(false);
    const short = parseMoney("125.3", "USD");
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe("VALIDATION_FAILED");
    const tooMany = parseMoney("125.377", "USD");
    expect(tooMany.ok).toBe(false);
  });

  test("TP-W1-003 rejects fractions for a zero-exponent currency", () => {
    const r = parseMoney("12.5", "JPY");
    expect(r.ok).toBe(false);
  });

  test("TP-W1-004 adding different currencies throws VALIDATION_FAILED", () => {
    const usd = Money.of(100n, "USD");
    const eur = Money.of(100n, "EUR");
    expect(() => usd.add(eur)).toThrow(/VALIDATION_FAILED/);
  });

  test("TP-W1-005 parser rejects JS numbers", () => {
    // Runtime guard: callers must pass a string, so a number is rejected even when typed loosely.
    const r = parseMoney(12.5, "USD");
    expect(r.ok).toBe(false);
  });

  test("TP-W1-006 same-currency sums and differences are exact", () => {
    for (let i = 0; i < 200; i++) {
      const a = BigInt(Math.floor(Math.random() * 1e12)) - 5n * 10n ** 11n;
      const b = BigInt(Math.floor(Math.random() * 1e12)) - 5n * 10n ** 11n;
      expect(Money.of(a, "USD").add(Money.of(b, "USD")).amount).toBe(a + b);
      expect(Money.of(a, "USD").subtract(Money.of(b, "USD")).amount).toBe(a - b);
    }
  });
});
