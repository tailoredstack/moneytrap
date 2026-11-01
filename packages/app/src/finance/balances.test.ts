import { describe, expect, test } from "bun:test";
import { createShareRule, type Id } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { BalanceConversion, PublisherBalanceSource } from "../ports/publisher-balance-source";
import { publisherBalances } from "./balances";

const publisherId = `pub_${"1".padStart(26, "0")}` as Id<"publisher">;
const otherPublisherId = `pub_${"2".padStart(26, "0")}` as Id<"publisher">;
const asOf = "2026-11-01T00:00:00.000Z";
// 70% of recognized revenue goes to the publisher, 30% to the platform.
const rule = createShareRule(7000, 3000, 0, 1);

function conversionId(sequence: number): Id<"conversion"> {
  return `cnv_${String(sequence).padStart(26, "0")}` as Id<"conversion">;
}

function conversion(sequence: number, overrides: Partial<BalanceConversion> = {}): BalanceConversion {
  return {
    conversionId: conversionId(sequence),
    currency: "USD",
    state: "approved",
    recognizedMinor: 10_000n,
    shareRule: rule,
    clearedAt: null,
    ...overrides,
  };
}

// An in-memory source keyed by publisher, standing in for the port. Only the port's contract is used here.
class InMemoryBalanceSource implements PublisherBalanceSource {
  private readonly rows = new Map<string, BalanceConversion[]>();

  add(publisher: Id<"publisher">, row: BalanceConversion): void {
    this.rows.set(publisher, [...(this.rows.get(publisher) ?? []), row]);
  }

  async listConversions(publisher: Id<"publisher">): Promise<BalanceConversion[]> {
    return this.rows.get(publisher) ?? [];
  }
}

function setup(conversions: BalanceConversion[], forPublisher: Id<"publisher"> = publisherId) {
  const source = new InMemoryBalanceSource();
  for (const row of conversions) source.add(forPublisher, row);
  const ctx = {
    db: undefined as never,
    clock: { now: () => new Date(asOf) },
    ids: undefined as never,
    actor: { type: "system", id: null },
  } satisfies Ctx;
  return { source, ctx };
}

describe("publisher balance view (DM-044, CT-016, CT-017)", () => {
  test("an approved conversion that has not been remitted is shown as approved, not available (TP-W6-026, CT-017)", async () => {
    const { source, ctx } = setup([conversion(1)]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.balances).toEqual([{ currency: "USD", estimatedMinor: 0n, approvedMinor: 7_000n, availableMinor: 0n }]);
  });

  test("available rises only once the conversion has cleared (TP-W6-027)", async () => {
    const cleared = setup([conversion(1, { clearedAt: new Date("2026-10-31T00:00:00.000Z") })]);
    const notYet = setup([conversion(1, { clearedAt: new Date("2026-11-02T00:00:00.000Z") })]);

    const clearedView = await publisherBalances(cleared.ctx, cleared.source, { publisherId });
    const notYetView = await publisherBalances(notYet.ctx, notYet.source, { publisherId });

    expect(clearedView.balances[0]).toEqual({
      currency: "USD",
      estimatedMinor: 0n,
      approvedMinor: 0n,
      availableMinor: 7_000n,
    });
    expect(notYetView.balances[0]).toEqual({
      currency: "USD",
      estimatedMinor: 0n,
      approvedMinor: 7_000n,
      availableMinor: 0n,
    });
  });

  test("estimated, approved, and available are reported separately and add up to the publisher share (TP-W6-028)", async () => {
    const { source, ctx } = setup([
      conversion(1, { state: "pending" }),
      conversion(2, { state: "approved" }),
      conversion(3, { state: "approved", clearedAt: new Date("2026-10-30T00:00:00.000Z") }),
    ]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.balances).toEqual([
      { currency: "USD", estimatedMinor: 7_000n, approvedMinor: 7_000n, availableMinor: 7_000n },
    ]);
    const [balance] = view.balances;
    expect(balance && balance.estimatedMinor + balance.approvedMinor + balance.availableMinor).toBe(21_000n);
  });

  test("declined and reversed conversions count toward no bucket", async () => {
    const { source, ctx } = setup([conversion(1, { state: "declined" }), conversion(2, { state: "reversed" })]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.balances).toEqual([]);
    expect(view.lines).toEqual([]);
  });

  test("a conversion with no status event yet is not counted", async () => {
    const { source, ctx } = setup([conversion(1, { state: null })]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.lines).toEqual([]);
  });

  test("another publisher's conversions are never counted", async () => {
    const { source, ctx } = setup([conversion(1)], otherPublisherId);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.balances).toEqual([]);
  });

  test("each conversion's publisher share is traceable as its own line (TP-W6-029)", async () => {
    const { source, ctx } = setup([conversion(1, { state: "pending" }), conversion(2, { recognizedMinor: 5_000n })]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.lines).toEqual([
      {
        conversionId: conversionId(1),
        currency: "USD",
        bucket: "estimated",
        publisherMinor: 7_000n,
        roundingVersion: 1,
      },
      {
        conversionId: conversionId(2),
        currency: "USD",
        bucket: "approved",
        publisherMinor: 3_500n,
        roundingVersion: 1,
      },
    ]);
  });

  test("the publisher share uses largest-remainder allocation, so no minor unit is lost", async () => {
    // 10 minor units at 33.33% / 33.33% / 33.34%: the publisher's floor is 3 and the leftover unit goes to the other bucket.
    const { source, ctx } = setup([
      conversion(1, { recognizedMinor: 10n, shareRule: createShareRule(3333, 3333, 3334, 2) }),
    ]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.lines[0]?.publisherMinor).toBe(3n);
    expect(view.lines[0]?.roundingVersion).toBe(2);
  });

  test("currencies are reported separately and never summed together", async () => {
    const { source, ctx } = setup([conversion(1), conversion(2, { currency: "EUR", recognizedMinor: 2_000n })]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.balances).toEqual([
      { currency: "EUR", estimatedMinor: 0n, approvedMinor: 1_400n, availableMinor: 0n },
      { currency: "USD", estimatedMinor: 0n, approvedMinor: 7_000n, availableMinor: 0n },
    ]);
  });

  test("the view is stamped with the time it was read", async () => {
    const { source, ctx } = setup([]);

    const view = await publisherBalances(ctx, source, { publisherId });

    expect(view.asOf.toISOString()).toBe(asOf);
  });
});
