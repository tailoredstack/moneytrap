import { describe, expect, test } from "bun:test";
import type { AllocationCandidate, Id } from "@moneytrap/domain";
import type { SettlementCandidateSource } from "../ports/settlement-candidate-source";
import type { ReceiptRecord } from "../ports/settlement-receipt-store";
import { matchReceipt } from "./match";

const conversion = (n: number) => `cnv_${String(n).padStart(26, "0")}` as Id<"conversion">;
const receiptId = "str_01arz3ndektsv4rrffq69g5fav" as Id<"settlementReceipt">;
const receivedAt = new Date("2026-03-20T12:00:00.000Z");

const receipt = (overrides: Partial<ReceiptRecord> = {}): ReceiptRecord => ({
  id: receiptId,
  networkId: "net_1",
  externalRef: "ref-1",
  grossMinor: 3000n,
  currency: "USD",
  receivedAt,
  state: "paid",
  objectRef: "upload:abc",
  ...overrides,
});

const candidate = (n: number, outstandingMinor: bigint): AllocationCandidate => ({
  conversionId: conversion(n),
  currency: "USD",
  outstandingMinor,
  occurredAt: new Date(Date.UTC(2026, 2, 1, 0, n)),
});

// Models the adapter contract: the eligible conversions for one network, with what is still open on each.
class MemoryCandidateSource implements SettlementCandidateSource {
  calls: string[] = [];
  constructor(private readonly byNetwork: Map<string, AllocationCandidate[]> = new Map()) {}

  async listEligibleConversions(networkId: string): Promise<AllocationCandidate[]> {
    this.calls.push(networkId);
    return this.byNetwork.get(networkId) ?? [];
  }
}

describe("receipt matching (TP-W7-003, TP-W7-004, CT-021; WP-7.2)", () => {
  test("a receipt covering 3 of 5 conversions clears three and leaves two pending (TP-W7-003)", async () => {
    const source = new MemoryCandidateSource(new Map([["net_1", [1, 2, 3, 4, 5].map((n) => candidate(n, 1000n))]]));
    const result = await matchReceipt(source, receipt());

    expect(result.receiptId).toBe(receiptId);
    expect(result.allocations.map((allocation) => allocation.conversionId)).toEqual([
      conversion(1),
      conversion(2),
      conversion(3),
    ]);
    expect(result.exceptions).toEqual([]);
  });

  test("a receipt that partially matches one conversion clears the matched portion and raises the remainder (TP-W7-004, CT-021)", async () => {
    const source = new MemoryCandidateSource(new Map([["net_1", [candidate(1, 1000n)]]]));
    const result = await matchReceipt(source, receipt({ grossMinor: 600n }));

    expect(result.allocations).toEqual([{ conversionId: conversion(1), allocatedMinor: 600n, currency: "USD" }]);
    expect(result.exceptions).toEqual([{ kind: "partial_conversion", conversionId: conversion(1), deltaMinor: 400n }]);
  });

  test("candidates are read for the receipt's own network only", async () => {
    const source = new MemoryCandidateSource(new Map([["net_2", [candidate(1, 1000n)]]]));
    const result = await matchReceipt(source, receipt());

    expect(source.calls).toEqual(["net_1"]);
    expect(result.allocations).toEqual([]);
    expect(result.exceptions).toEqual([{ kind: "unallocated_receipt", deltaMinor: 3000n }]);
  });
});
