import type { Id } from "@moneytrap/domain";

export interface ClickCountQuery {
  // The tenant the counts are read for. Only links of this organization are counted.
  readonly organizationId: Id<"organization">;
  // Half-open window: a click counts when from <= occurred_at < to.
  readonly from: Date;
  readonly to: Date;
  // Keyset cursor: only links after this link ID are returned. Null starts from the first link.
  readonly afterLinkId: string | null;
  // Rows to return at most. The reader asks for one more than a page to learn whether another page exists.
  readonly limit: number;
}

export interface ClickCountRow {
  readonly linkId: string;
  readonly clicks: number;
}

// Read-only. Counts come from the recorded click facts, joined to the organization's links (WP-5.9).
export interface ClickReportStore {
  // Links in ascending ID order. A link with no clicks in the window is not returned.
  countByLink(query: ClickCountQuery): Promise<readonly ClickCountRow[]>;
  // The largest gap, in milliseconds, between a click occurring and its being recorded, over this organization's clicks
  // recorded at or after `since`. Null when none were recorded in that span. A large gap means ingestion ran late.
  recordedDelayMs(organizationId: Id<"organization">, since: Date): Promise<number | null>;
}
