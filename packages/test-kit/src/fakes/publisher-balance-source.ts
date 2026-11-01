import type { BalanceConversion, PublisherBalanceSource } from "@moneytrap/app/src/ports/publisher-balance-source";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for the publisher balance source. Rows are keyed by publisher, so one publisher never sees another's conversions. */
export class FakePublisherBalanceSource implements PublisherBalanceSource {
  private readonly rows = new Map<string, BalanceConversion[]>();

  /** Seeds one conversion for a publisher. */
  add(publisherId: Id<"publisher">, row: BalanceConversion): void {
    this.rows.set(publisherId, [...(this.rows.get(publisherId) ?? []), row]);
  }

  /** Drops every conversion of a publisher, as a reversal that takes the whole balance back would. */
  clear(publisherId: Id<"publisher">): void {
    this.rows.delete(publisherId);
  }

  async listConversions(publisherId: Id<"publisher">): Promise<BalanceConversion[]> {
    return [...(this.rows.get(publisherId) ?? [])];
  }
}
