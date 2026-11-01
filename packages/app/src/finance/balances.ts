import { allocate, type CurrencyCode, type Id, Money } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { BalanceConversion, PublisherBalanceSource } from "../ports/publisher-balance-source";

// The three buckets a publisher sees (DM-044, §5.1 invariant 10). They are disjoint, so they add up to the publisher's
// total share: estimated (pending), approved (approved but not yet cleared), available (approved and cleared).
export type BalanceBucket = "estimated" | "approved" | "available";

export interface BalanceLine {
  conversionId: Id<"conversion">;
  currency: CurrencyCode;
  bucket: BalanceBucket;
  publisherMinor: bigint;
  roundingVersion: number;
}

export interface CurrencyBalance {
  currency: CurrencyCode;
  estimatedMinor: bigint;
  approvedMinor: bigint;
  availableMinor: bigint;
}

export interface PublisherBalanceView {
  asOf: Date;
  // One row per currency with a counted conversion, sorted by currency. Currencies are never summed together.
  balances: CurrencyBalance[];
  // The publisher share of each counted conversion, so each balance traces back to its conversion (TP-W6-029).
  lines: BalanceLine[];
}

// Pending is estimated. Approved is approved until it clears, and available only from its clearance on, never before
// (CT-017, TP-W6-027). Declined and reversed conversions earn nothing. A conversion with no status event has no known
// state yet, so it is not counted.
function bucketOf(conversion: BalanceConversion, asOf: Date): BalanceBucket | null {
  switch (conversion.state) {
    case "pending":
      return "estimated";
    case "approved":
      return conversion.clearedAt !== null && conversion.clearedAt.getTime() <= asOf.getTime()
        ? "available"
        : "approved";
    default:
      return null;
  }
}

const TOTAL_KEY = {
  estimated: "estimatedMinor",
  approved: "approvedMinor",
  available: "availableMinor",
} as const satisfies Record<BalanceBucket, keyof Omit<CurrencyBalance, "currency">>;

// Reads a publisher's balances as of the clock. The publisher share of each conversion comes from the same largest-remainder
// allocation that splits recognized revenue (CT-016), so the view and the ledger agree on the amounts.
export async function publisherBalances(
  ctx: Ctx,
  source: PublisherBalanceSource,
  input: { publisherId: Id<"publisher"> },
): Promise<PublisherBalanceView> {
  const asOf = ctx.clock.now();
  const conversions = await source.listConversions(input.publisherId);

  const lines: BalanceLine[] = [];
  const totals = new Map<CurrencyCode, CurrencyBalance>();
  for (const conversion of conversions) {
    const bucket = bucketOf(conversion, asOf);
    if (bucket === null) continue;

    const allocation = allocate(Money.of(conversion.recognizedMinor, conversion.currency), conversion.shareRule);
    const publisherMinor = allocation.publisher.amount;
    lines.push({
      conversionId: conversion.conversionId,
      currency: conversion.currency,
      bucket,
      publisherMinor,
      roundingVersion: allocation.roundingVersion,
    });

    const total = totals.get(conversion.currency) ?? {
      currency: conversion.currency,
      estimatedMinor: 0n,
      approvedMinor: 0n,
      availableMinor: 0n,
    };
    total[TOTAL_KEY[bucket]] += publisherMinor;
    totals.set(conversion.currency, total);
  }

  const balances = [...totals.values()].sort((a, b) =>
    a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0,
  );
  return { asOf, balances, lines };
}
