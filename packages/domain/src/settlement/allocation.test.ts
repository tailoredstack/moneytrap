import { describe, expect, test } from "bun:test";
import type { Id } from "../ids/ids";
import { type AllocationCandidate, allocateReceipt } from "./allocation";

const conversion = (n: number) => `cnv_${String(n).padStart(26, "0")}` as Id<"conversion">;
const at = (minutes: number) => new Date(Date.UTC(2026, 2, 1, 0, minutes));

const candidate = (
  n: number,
  outstandingMinor: bigint,
  overrides: Partial<AllocationCandidate> = {},
): AllocationCandidate => ({
  conversionId: conversion(n),
  currency: "USD",
  outstandingMinor,
  occurredAt: at(n),
  ...overrides,
});

describe("receipt allocation (TP-W7-003, TP-W7-004, DM-042, DM-043, CT-021; WP-7.2)", () => {
  test("a receipt covering 3 of 5 conversions clears the three oldest and leaves two pending (TP-W7-003)", () => {
    const candidates = [1, 2, 3, 4, 5].map((n) => candidate(n, 1000n));
    const plan = allocateReceipt({ grossMinor: 3000n, currency: "USD" }, candidates);

    expect(plan.allocations).toEqual([
      { conversionId: conversion(1), allocatedMinor: 1000n, currency: "USD" },
      { conversionId: conversion(2), allocatedMinor: 1000n, currency: "USD" },
      { conversionId: conversion(3), allocatedMinor: 1000n, currency: "USD" },
    ]);
    // Exact coverage at a conversion boundary is not a partial match, so nothing becomes an exception.
    expect(plan.exceptions).toEqual([]);
  });

  test("a receipt that partially covers one conversion clears only the matched portion and raises its remainder as an exception (TP-W7-004, CT-021)", () => {
    const plan = allocateReceipt({ grossMinor: 600n, currency: "USD" }, [candidate(1, 1000n)]);

    expect(plan.allocations).toEqual([{ conversionId: conversion(1), allocatedMinor: 600n, currency: "USD" }]);
    expect(plan.exceptions).toEqual([{ kind: "partial_conversion", conversionId: conversion(1), deltaMinor: 400n }]);
  });

  test("a partial match stops the fill: later conversions stay pending, with no allocation and no exception", () => {
    const plan = allocateReceipt({ grossMinor: 1500n, currency: "USD" }, [candidate(1, 1000n), candidate(2, 1000n)]);

    expect(plan.allocations).toEqual([
      { conversionId: conversion(1), allocatedMinor: 1000n, currency: "USD" },
      { conversionId: conversion(2), allocatedMinor: 500n, currency: "USD" },
    ]);
    expect(plan.exceptions).toEqual([{ kind: "partial_conversion", conversionId: conversion(2), deltaMinor: 500n }]);
  });

  test("receipt value beyond every eligible conversion is an unallocated exception", () => {
    const plan = allocateReceipt({ grossMinor: 2500n, currency: "USD" }, [candidate(1, 1000n)]);

    expect(plan.allocations).toEqual([{ conversionId: conversion(1), allocatedMinor: 1000n, currency: "USD" }]);
    expect(plan.exceptions).toEqual([{ kind: "unallocated_receipt", deltaMinor: 1500n }]);
  });

  test("candidates in another currency are never allocated and do not stop the receipt from matching", () => {
    const plan = allocateReceipt({ grossMinor: 1000n, currency: "USD" }, [
      candidate(1, 500n, { currency: "EUR" }),
      candidate(2, 1000n),
    ]);

    expect(plan.allocations).toEqual([{ conversionId: conversion(2), allocatedMinor: 1000n, currency: "USD" }]);
    expect(plan.exceptions).toEqual([]);
  });

  test("a receipt in a currency no candidate uses is entirely unallocated", () => {
    const plan = allocateReceipt({ grossMinor: 700n, currency: "GBP" }, [candidate(1, 1000n)]);

    expect(plan.allocations).toEqual([]);
    expect(plan.exceptions).toEqual([{ kind: "unallocated_receipt", deltaMinor: 700n }]);
  });

  test("candidates with nothing outstanding are skipped, and a zero receipt allocates nothing and raises nothing", () => {
    const plan = allocateReceipt({ grossMinor: 0n, currency: "USD" }, [candidate(1, 1000n)]);
    expect(plan).toEqual({ allocations: [], exceptions: [] });

    const skipped = allocateReceipt({ grossMinor: 400n, currency: "USD" }, [candidate(1, 0n), candidate(2, 400n)]);
    expect(skipped.allocations).toEqual([{ conversionId: conversion(2), allocatedMinor: 400n, currency: "USD" }]);
  });

  test("the fill order is oldest first, with the conversion ID as the tie-break, whatever order the candidates arrive in", () => {
    const forward = [candidate(1, 500n), candidate(2, 500n), candidate(3, 500n, { occurredAt: at(1) })];
    const reversed = [...forward].reverse();

    const a = allocateReceipt({ grossMinor: 700n, currency: "USD" }, forward);
    const b = allocateReceipt({ grossMinor: 700n, currency: "USD" }, reversed);

    expect(a).toEqual(b);
    expect(a.allocations.map((allocation) => allocation.conversionId)).toEqual([conversion(1), conversion(3)]);
  });

  test("amounts stay bigint minor units with no float rounding (ADR-005)", () => {
    const big = 9_007_199_254_740_993n;
    const plan = allocateReceipt({ grossMinor: big, currency: "USD" }, [candidate(1, big - 1n)]);

    expect(plan.allocations[0]?.allocatedMinor).toBe(big - 1n);
    expect(plan.exceptions).toEqual([{ kind: "unallocated_receipt", deltaMinor: 1n }]);
  });

  test("the allocated total equals the receipt gross and never exceeds a conversion's outstanding amount", () => {
    const plan = allocateReceipt({ grossMinor: 1234n, currency: "USD" }, [candidate(1, 999n), candidate(2, 300n)]);

    expect(plan.allocations).toEqual([
      { conversionId: conversion(1), allocatedMinor: 999n, currency: "USD" },
      { conversionId: conversion(2), allocatedMinor: 235n, currency: "USD" },
    ]);
    expect(plan.exceptions).toEqual([{ kind: "partial_conversion", conversionId: conversion(2), deltaMinor: 65n }]);
  });
});
