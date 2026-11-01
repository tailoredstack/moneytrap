import type { ConversionState, CurrencyCode, Id, ShareRule } from "@moneytrap/domain";

// One conversion that belongs to a publisher, as the balance view needs it. recognizedMinor is the latest source revision
// plus every adjustment, so the adapter nets clawbacks before the view allocates. A conversion with no status event has
// state null.
export interface BalanceConversion {
  conversionId: Id<"conversion">;
  currency: CurrencyCode;
  state: ConversionState | null;
  recognizedMinor: bigint;
  shareRule: ShareRule;
  // When the conversion cleared for payout, or null while it has not. Clearance is the point after which approved funds
  // are available.
  clearedAt: Date | null;
}

export interface PublisherBalanceSource {
  listConversions(publisherId: Id<"publisher">): Promise<BalanceConversion[]>;
}
