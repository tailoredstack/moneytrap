import type { ClickObservation, ClickRecordOutcome, ClickStore } from "../ports/click-store";

const MAX_DEDUP_KEY = 200;

// Records one logical click (API-044, DM-030, WP-5.8). The store keeps at most one fact per dedup key, so a click emitted
// twice, or an event replayed after a crash, leaves one row. Distinct clicks have distinct keys and are all kept.
// Invalid input throws: the caller is the event consumer, and a malformed event is a bug to surface, not to store.
export async function recordClick(store: ClickStore, click: ClickObservation): Promise<ClickRecordOutcome> {
  if (typeof click.dedupKey !== "string" || click.dedupKey.trim() === "") {
    throw new RangeError("dedupKey is required");
  }
  if (click.dedupKey.length > MAX_DEDUP_KEY) throw new RangeError("dedupKey is too long");
  if (typeof click.linkId !== "string" || click.linkId.trim() === "") {
    throw new RangeError("linkId is required");
  }
  if (!(click.occurredAt instanceof Date) || Number.isNaN(click.occurredAt.getTime())) {
    throw new RangeError("occurredAt must be a valid date");
  }
  return store.record(click);
}
