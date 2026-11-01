import type { Id } from "@moneytrap/domain";
import type { BalanceConversion } from "./publisher-balance-source";

// What the earnings report reads from the finance source: the publisher's conversions plus when the source last synced.
// syncedAt is null when the source has never synced, so it is treated as stale rather than as zero earnings.
export interface EarningsSourceSnapshot {
  syncedAt: Date | null;
  conversions: BalanceConversion[];
}

export interface EarningsSource {
  snapshot(publisherId: Id<"publisher">): Promise<EarningsSourceSnapshot>;
}
