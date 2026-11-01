import type { EarningsSource, EarningsSourceSnapshot } from "@moneytrap/app/src/ports/earnings-source";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the earnings source. Snapshots are keyed by publisher, so one publisher never sees another's data. */
export class FakeEarningsSource implements EarningsSource {
  private readonly snapshots = new Map<string, EarningsSourceSnapshot>();

  /** Seeds the snapshot a publisher's earnings are read from. */
  set(publisherId: Id<"publisher">, snapshot: EarningsSourceSnapshot): void {
    this.snapshots.set(publisherId, snapshot);
  }

  /** A publisher with no seeded snapshot has never synced, so it reads as stale. */
  async snapshot(publisherId: Id<"publisher">): Promise<EarningsSourceSnapshot> {
    return this.snapshots.get(publisherId) ?? { syncedAt: null, conversions: [] };
  }
}
