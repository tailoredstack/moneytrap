import { describe, expect, test } from "bun:test";
import {
  createPayoutPolicy,
  evaluatePayout,
  isHoldActive,
  type PayoutHold,
  type PayoutPolicy,
  policyInEffect,
} from "./policy";

const at = new Date("2026-06-15T00:00:00.000Z");

function policy(overrides: Partial<PayoutPolicy> = {}): PayoutPolicy {
  return createPayoutPolicy({
    version: 1,
    currency: "GBP",
    minimumMinor: 5000n,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  });
}

function inEffect(policies: readonly PayoutPolicy[], at: Date): PayoutPolicy {
  const policy = policyInEffect(policies, "GBP", at);
  if (!policy) throw new Error("no payout policy in effect");
  return policy;
}

function hold(overrides: Partial<PayoutHold> = {}): PayoutHold {
  return {
    id: "pho_test",
    publisherId: "pub_test",
    currency: "GBP",
    amountMinor: 1n,
    reason: "KYB review",
    placedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: null,
    releasedAt: null,
    ...overrides,
  };
}

describe("createPayoutPolicy (DM-045)", () => {
  test("rejects a version below 1, a negative minimum, and a non-integer minimum", () => {
    expect(() => policy({ version: 0 })).toThrow(RangeError);
    expect(() => policy({ minimumMinor: -1n })).toThrow(RangeError);
    expect(() => policy({ minimumMinor: 1.5 as unknown as bigint })).toThrow(RangeError);
  });
});

describe("policyInEffect (versioned policy)", () => {
  const v1 = policy({ version: 1, minimumMinor: 5000n, effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
  const v2 = policy({ version: 2, minimumMinor: 10000n, effectiveFrom: new Date("2026-06-01T00:00:00.000Z") });

  test("returns the version whose effective date is the latest at or before the instant", () => {
    expect(policyInEffect([v1, v2], "GBP", new Date("2026-03-01T00:00:00.000Z"))?.version).toBe(1);
    expect(policyInEffect([v1, v2], "GBP", new Date("2026-06-01T00:00:00.000Z"))?.version).toBe(2);
    expect(policyInEffect([v2, v1], "GBP", at)?.version).toBe(2);
  });

  test("returns null before any version takes effect or for another currency", () => {
    expect(policyInEffect([v1, v2], "GBP", new Date("2025-12-31T23:59:59.000Z"))).toBeNull();
    expect(policyInEffect([v1, v2], "EUR", at)).toBeNull();
  });
});

describe("isHoldActive", () => {
  test("a hold is active until it is released or its expiry passes", () => {
    expect(isHoldActive(hold(), at)).toBe(true);
    expect(isHoldActive(hold({ expiresAt: new Date("2026-06-16T00:00:00.000Z") }), at)).toBe(true);
    expect(isHoldActive(hold({ expiresAt: at }), at)).toBe(false);
    expect(isHoldActive(hold({ releasedAt: new Date("2026-06-01T00:00:00.000Z") }), at)).toBe(false);
  });
});

describe("evaluatePayout (TP-W7-009, TP-W7-010)", () => {
  test("below the minimum the publisher is excluded and the amount is not payable", () => {
    const decision = evaluatePayout({ policy: policy(), availableMinor: 4999n, holds: [], at });
    expect(decision).toMatchObject({ eligible: false, payableMinor: 0n, exclusions: ["below_minimum"] });
  });

  test("at the minimum the publisher is eligible for the full available amount", () => {
    const decision = evaluatePayout({ policy: policy(), availableMinor: 5000n, holds: [], at });
    expect(decision).toMatchObject({ eligible: true, payableMinor: 5000n, exclusions: [], policyVersion: 1 });
  });

  test("an active hold excludes the publisher and returns the active holds with their reasons", () => {
    const active = hold({ reason: "chargeback review" });
    const decision = evaluatePayout({
      policy: policy(),
      availableMinor: 90000n,
      holds: [active, hold({ id: "pho_released", releasedAt: at })],
      at,
    });
    expect(decision).toMatchObject({ eligible: false, payableMinor: 0n, exclusions: ["held"] });
    expect(decision.holds.map((h) => h.reason)).toEqual(["chargeback review"]);
  });

  test("a replay before the hold was placed does not see it", () => {
    const placedLater = hold({ placedAt: new Date("2026-07-01T00:00:00.000Z") });
    const decision = evaluatePayout({ policy: policy(), availableMinor: 9000n, holds: [placedLater], at });
    expect(decision).toMatchObject({ eligible: true, exclusions: [] });
  });

  test("a replay before a release instant still sees the hold as active", () => {
    const releasedLater = hold({ releasedAt: new Date("2026-07-01T00:00:00.000Z") });
    const decision = evaluatePayout({ policy: policy(), availableMinor: 9000n, holds: [releasedLater], at });
    expect(decision).toMatchObject({ eligible: false, exclusions: ["held"] });
  });

  test("a hold in another currency does not exclude the publisher", () => {
    const decision = evaluatePayout({
      policy: policy(),
      availableMinor: 9000n,
      holds: [hold({ currency: "EUR" })],
      at,
    });
    expect(decision.eligible).toBe(true);
  });

  test("zero available is never payable, even with a zero minimum", () => {
    const decision = evaluatePayout({ policy: policy({ minimumMinor: 0n }), availableMinor: 0n, holds: [], at });
    expect(decision.eligible).toBe(false);
  });

  test("a decision made before v2 is published is unchanged when it is replayed after v2 exists", () => {
    const v1 = policy({ version: 1, minimumMinor: 5000n });
    const v2 = policy({ version: 2, minimumMinor: 10000n, effectiveFrom: new Date("2026-06-01T00:00:00.000Z") });
    const before = new Date("2026-03-01T00:00:00.000Z");
    const decidedThen = evaluatePayout({
      policy: inEffect([v1], before),
      availableMinor: 7000n,
      holds: [],
      at: before,
    });
    const replayNow = evaluatePayout({
      policy: inEffect([v1, v2], before),
      availableMinor: 7000n,
      holds: [],
      at: before,
    });
    expect(replayNow).toEqual(decidedThen);
    expect(decidedThen).toMatchObject({ eligible: true, policyVersion: 1 });
  });
});
