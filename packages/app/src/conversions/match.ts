import type { Id } from "@moneytrap/domain";
import type { AttributableClick, AttributionClickStore } from "../ports/attribution-click-store";

// A conversion is attributed to a click made this long before it, at the latest (DM-036, WP-6.7). The value is a platform
// decision: the spec sets no window, and 30 days matches the longest network cookie lifetime we import.
export const ATTRIBUTION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface AttributionInput {
  conversionId: Id<"conversion">;
  // The publisher's sub ID from the source fact. Null means the network sent none, so nothing can be matched.
  subId: string | null;
  occurredAt: Date;
}

export type AttributionResult =
  | {
      kind: "attributed";
      linkId: string;
      publisherId: string;
      clickDedupKey: string;
      // Recorded so the choice can be audited when more than one click qualifies (TP-W6-024).
      rule: "last_click_in_window";
    }
  | {
      kind: "exception";
      conversionId: Id<"conversion">;
      // no_click: no click carries the sub ID. window: clicks exist, but none falls in the window before the conversion.
      reason: "no_click" | "window";
    };

// Matches one conversion to one click, or sends it to the exception queue. A conversion is never assigned to a publisher
// without a click that qualifies, so an unmatched conversion carries no publisher (CT-020). Among qualifying clicks, the
// latest one before the conversion wins; a tie goes to the smaller dedup key, so the choice never depends on lookup order.
export async function matchConversion(
  store: AttributionClickStore,
  input: AttributionInput,
): Promise<AttributionResult> {
  if (input.subId === null || input.subId.trim() === "") {
    return { kind: "exception", conversionId: input.conversionId, reason: "no_click" };
  }
  const candidates = await store.clicksWithSubId(input.subId);
  if (candidates.length === 0) {
    return { kind: "exception", conversionId: input.conversionId, reason: "no_click" };
  }

  const converted = input.occurredAt.getTime();
  const earliest = converted - ATTRIBUTION_WINDOW_MS;
  const inWindow = candidates.filter((click) => {
    const at = click.occurredAt.getTime();
    return at <= converted && at >= earliest;
  });
  if (inWindow.length === 0) {
    return { kind: "exception", conversionId: input.conversionId, reason: "window" };
  }

  const chosen = inWindow.reduce((best, click) => (precedes(click, best) ? click : best));
  return {
    kind: "attributed",
    linkId: chosen.linkId,
    publisherId: chosen.publisherId,
    clickDedupKey: chosen.dedupKey,
    rule: "last_click_in_window",
  };
}

// True when `a` is the click to keep over `b`: the later one, or on a tie the smaller dedup key.
function precedes(a: AttributableClick, b: AttributableClick): boolean {
  const aAt = a.occurredAt.getTime();
  const bAt = b.occurredAt.getTime();
  if (aAt !== bAt) return aAt > bAt;
  return a.dedupKey < b.dedupKey;
}
