import { describe, expect, test } from "bun:test";
import { createShareRule, type Id } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { EarningsSource, EarningsSourceSnapshot } from "../ports/earnings-source";
import type { BalanceConversion } from "../ports/publisher-balance-source";
import { EARNINGS_STALE_AFTER_MS, publisherEarnings } from "./earnings";

const publisherId = `pub_${"1".padStart(26, "0")}` as Id<"publisher">;
const now = new Date("2026-11-01T12:00:00.000Z");
// 70% of recognized revenue goes to the publisher, 30% to the platform.
const rule = createShareRule(7000, 3000, 0, 1);

function conversionId(sequence: number): Id<"conversion"> {
  return `cnv_${String(sequence).padStart(26, "0")}` as Id<"conversion">;
}

function conversion(sequence: number, overrides: Partial<BalanceConversion> = {}): BalanceConversion {
  return {
    conversionId: conversionId(sequence),
    currency: "USD",
    state: "pending",
    recognizedMinor: 10_000n,
    shareRule: rule,
    clearedAt: null,
    ...overrides,
  };
}

// A source that returns one fixed snapshot, standing in for the port.
class FixedEarningsSource implements EarningsSource {
  constructor(private readonly snapshotValue: EarningsSourceSnapshot) {}

  async snapshot(): Promise<EarningsSourceSnapshot> {
    return this.snapshotValue;
  }
}

function ctxAt(at: Date): Ctx {
  return {
    db: undefined as never,
    clock: { now: () => new Date(at) },
    ids: undefined as never,
    actor: { type: "system", id: null },
  };
}

function freshSnapshot(conversions: BalanceConversion[]): EarningsSourceSnapshot {
  return { syncedAt: new Date(now.getTime() - 60_000), conversions };
}

describe("publisherEarnings", () => {
  test("amounts carry the currency and the as_of instant they were read at", async () => {
    const source = new FixedEarningsSource(freshSnapshot([conversion(1)]));
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "USD" });

    expect(report.dataStale).toBe(false);
    expect(report.currency).toBe("USD");
    expect(report.asOf).toEqual(now);
  });

  test("splits the publisher share into pending, approved, and cleared, using the balance rules", async () => {
    const source = new FixedEarningsSource(
      freshSnapshot([
        conversion(1, { state: "pending" }),
        conversion(2, { state: "approved", clearedAt: null }),
        conversion(3, { state: "approved", clearedAt: new Date("2026-11-01T11:00:00.000Z") }),
        conversion(4, { state: "declined" }),
        conversion(5, { state: "reversed" }),
      ]),
    );
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "USD" });

    expect(report).toEqual({
      dataStale: false,
      currency: "USD",
      asOf: now,
      amounts: { pendingMinor: 7_000n, approvedMinor: 7_000n, clearedMinor: 7_000n },
    });
  });

  test("reports only the requested currency", async () => {
    const source = new FixedEarningsSource(
      freshSnapshot([conversion(1, { state: "pending" }), conversion(2, { currency: "EUR", state: "pending" })]),
    );
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "EUR" });

    expect(report.dataStale).toBe(false);
    expect(report.amounts).toEqual({ pendingMinor: 7_000n, approvedMinor: 0n, clearedMinor: 0n });
  });

  test("a fresh source with no conversions in the currency is a genuine zero", async () => {
    const source = new FixedEarningsSource(freshSnapshot([]));
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "USD" });

    expect(report).toEqual({
      dataStale: false,
      currency: "USD",
      asOf: now,
      amounts: { pendingMinor: 0n, approvedMinor: 0n, clearedMinor: 0n },
    });
  });

  test("a stale source shows data_stale with no amounts, never zero", async () => {
    const syncedAt = new Date(now.getTime() - EARNINGS_STALE_AFTER_MS - 1);
    const source = new FixedEarningsSource({ syncedAt, conversions: [conversion(1, { state: "pending" })] });
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "USD" });

    expect(report).toEqual({ dataStale: true, currency: "USD", asOf: now, lastSyncedAt: syncedAt, amounts: null });
  });

  test("a source that has never synced is stale, not zero", async () => {
    const source = new FixedEarningsSource({ syncedAt: null, conversions: [] });
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "USD" });

    expect(report).toEqual({ dataStale: true, currency: "USD", asOf: now, lastSyncedAt: null, amounts: null });
  });

  test("a source synced exactly at the stale threshold is still current", async () => {
    const syncedAt = new Date(now.getTime() - EARNINGS_STALE_AFTER_MS);
    const source = new FixedEarningsSource({ syncedAt, conversions: [conversion(1, { state: "pending" })] });
    const report = await publisherEarnings(ctxAt(now), { source }, { publisherId, currency: "USD" });

    expect(report.dataStale).toBe(false);
    expect(report.amounts).toEqual({ pendingMinor: 7_000n, approvedMinor: 0n, clearedMinor: 0n });
  });
});
