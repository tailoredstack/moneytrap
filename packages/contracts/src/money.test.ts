import { describe, expect, test } from "bun:test";
import { Money } from "@moneytrap/domain";
import { Value } from "@sinclair/typebox/value";
import { decodeMoney, encodeMoney, MoneySchema } from "./money";

describe("Money contract", () => {
  test("TP-W1-027 encodes minor units as the decimal string from Money.format", () => {
    const money = Money.of(12537n, "USD");
    expect(encodeMoney(money)).toEqual({ amount: money.format(), currency: "USD" });
    expect(encodeMoney(money)).toEqual({ amount: "125.37", currency: "USD" });
  });

  test("TP-W1-027 keeps the sign and zero-exponent currencies exact", () => {
    expect(encodeMoney(Money.of(-5n, "USD"))).toEqual({ amount: "-0.05", currency: "USD" });
    expect(encodeMoney(Money.of(1200n, "JPY"))).toEqual({ amount: "1200", currency: "JPY" });
  });

  test("TP-W1-027 decodes the encoded value back to the same minor units", () => {
    const decoded = decodeMoney(encodeMoney(Money.of(-12537n, "EUR")));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) {
      expect(decoded.value.amount).toBe(-12537n);
      expect(decoded.value.currency).toBe("EUR");
    }
  });

  test("TP-W1-027 rejects a JSON number amount", () => {
    expect(decodeMoney({ amount: 125.37, currency: "USD" }).ok).toBe(false);
  });

  test("schema accepts the canonical shape and rejects a float string", () => {
    expect(Value.Check(MoneySchema, { amount: "125.37", currency: "USD" })).toBe(true);
    expect(Value.Check(MoneySchema, { amount: "125.3.7", currency: "USD" })).toBe(false);
    expect(Value.Check(MoneySchema, { amount: "125.37", currency: "usd" })).toBe(false);
  });
});
