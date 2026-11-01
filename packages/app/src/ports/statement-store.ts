import type { CurrencyCode, Id } from "@moneytrap/domain";
import type { StatementContent } from "../finance/statements";

// One closed statement, the stored form of DM-050. contentHash is the sha256 of the canonical content (see statements.ts).
export interface StatementRecord {
  id: Id<"statement">;
  publisherId: Id<"publisher">;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
  revision: number;
  contentHash: string;
  objectRef: string;
  content: StatementContent;
  createdAt: Date;
}

// A closed period is final. recordClosed writes the statement only when the period has none, and returns false, writing
// nothing, when a concurrent close already recorded it. Nothing updates or deletes a statement row.
export interface StatementStore {
  findClosed(
    publisherId: Id<"publisher">,
    currency: CurrencyCode,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<StatementRecord | null>;
  recordClosed(record: StatementRecord): Promise<boolean>;
  list(publisherId: Id<"publisher">): Promise<StatementRecord[]>;
}
