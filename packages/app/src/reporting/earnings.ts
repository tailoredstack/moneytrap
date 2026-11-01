import type { CurrencyCode, Id } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import { publisherBalances } from "../finance/balances";
import type { EarningsSource } from "../ports/earnings-source";

// A source that has not synced for longer than this is stale. Earnings then show data_stale instead of amounts, so a
// lagging source is never read as zero earnings. The threshold matches the click report (API-045).
export const EARNINGS_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface EarningsAmounts {
  // Estimated (pending) publisher share, from the balance view's estimated bucket.
  pendingMinor: bigint;
  // Approved but not yet cleared for payout.
  approvedMinor: bigint;
  // Approved and cleared for payout.
  clearedMinor: bigint;
}

// Every report carries its currency and the as_of instant it was read at. A stale report has no amounts at all, so a
// caller cannot mistake a stale source for a zero balance.
export type EarningsReport =
  | { dataStale: false; currency: CurrencyCode; asOf: Date; amounts: EarningsAmounts }
  | { dataStale: true; currency: CurrencyCode; asOf: Date; lastSyncedAt: Date | null; amounts: null };

// Reads one publisher's earnings in one currency (API-047, UI-042). The amounts come from the same balance rules as
// WP-6.9, so the earnings report and the balance view agree. The route has already checked the caller's scope.
export async function publisherEarnings(
  ctx: Ctx,
  deps: { source: EarningsSource },
  input: { publisherId: Id<"publisher">; currency: CurrencyCode },
): Promise<EarningsReport> {
  const asOf = ctx.clock.now();
  const snapshot = await deps.source.snapshot(input.publisherId);

  if (snapshot.syncedAt === null || asOf.getTime() - snapshot.syncedAt.getTime() > EARNINGS_STALE_AFTER_MS) {
    return { dataStale: true, currency: input.currency, asOf, lastSyncedAt: snapshot.syncedAt, amounts: null };
  }

  const view = await publisherBalances(
    ctx,
    { listConversions: async () => snapshot.conversions },
    { publisherId: input.publisherId },
  );
  const balance = view.balances.find((row) => row.currency === input.currency);
  return {
    dataStale: false,
    currency: input.currency,
    asOf,
    amounts: {
      pendingMinor: balance?.estimatedMinor ?? 0n,
      approvedMinor: balance?.approvedMinor ?? 0n,
      clearedMinor: balance?.availableMinor ?? 0n,
    },
  };
}
