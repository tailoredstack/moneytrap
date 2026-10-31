import { describe, expect, test } from "bun:test";
import { Money } from "../money/money";
import { createShareRule } from "./share-rule";
import { allocate } from "./allocate";

describe("allocate largest remainder", () => {
  test("70/30 on 0.01 USD sums exactly", () => {
    const rule = createShareRule(7000, 3000, 0, 1);
    const recognized = Money.of(1n, "USD");
    const a = allocate(recognized, rule);
    expect(a.publisher.amount + a.platform.amount + a.other.amount).toBe(1n);
    expect(a.publisher.amount).toBe(1n);
    expect(a.platform.amount).toBe(0n);
  });
  test("currency propagation and roundingVersion", () => {
    const rule = createShareRule(5000, 2500, 2500, 2);
    const a = allocate(Money.of(10n, "USD"), rule);
    expect(a.currency).toBe("USD");
    expect(a.roundingVersion).toBe(2);
    expect(a.publisher.amount + a.platform.amount + a.other.amount).toBe(10n);
  });
  test("tie remainder deterministic", () => {
    const rule = createShareRule(3333, 3333, 3334, 1);
    const a = allocate(Money.of(10n, "USD"), rule);
    expect(a.publisher.amount + a.platform.amount + a.other.amount).toBe(10n);
  });
  test("multi-bucket remainder exact", () => {
    const rule = createShareRule(3333, 3333, 3334, 1);
    const a = allocate(Money.of(10n, "USD"), rule);
    // 10 * 3333/10000 = 3.333 -> floor 3 rem 3330; three buckets -> remainders; total 10
    expect(a.publisher.amount + a.platform.amount + a.other.amount).toBe(10n);
    expect([a.publisher.amount, a.platform.amount, a.other.amount].sort()).toEqual([3n, 3n, 4n]);
  });
  test("zero amount", () => {
    const rule = createShareRule(5000, 2500, 2500, 1);
    const a = allocate(Money.of(0n, "USD"), rule);
    expect(a.publisher.amount).toBe(0n);
    expect(a.platform.amount).toBe(0n);
    expect(a.other.amount).toBe(0n);
  });
});