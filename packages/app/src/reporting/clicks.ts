import { type Id, parseId } from "@moneytrap/domain";
import type { ClickCountRow, ClickReportStore } from "../ports/click-report-store";
import type { Clock } from "../ports/clock";

export const DEFAULT_CLICK_PAGE_SIZE = 50;
export const MAX_CLICK_PAGE_SIZE = 200;
// A window may not exceed this, so one request cannot scan an unbounded history.
export const MAX_CLICK_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
// Clicks are ingested asynchronously, so the newest one can trail the redirect by a while. When the newest recorded
// click of the organization is older than this and the window reaches past it, the counts may be incomplete.
export const CLICK_DATA_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ClickReportDeps {
  clicks: ClickReportStore;
  clock: Clock;
}

export interface ClickReportInput {
  organizationId: Id<"organization">;
  // ISO-8601 instants from the caller. Anything else is refused as VALIDATION_FAILED.
  from: unknown;
  to: unknown;
  // The link ID the previous page ended on, as returned in nextCursor.
  cursor?: unknown;
  limit?: unknown;
}

export interface ClickReportPage {
  data: readonly ClickCountRow[];
  nextCursor: string | null;
  // The instant the counts were read at. Every total on the page is as of this time.
  asOf: Date;
  dataStale: boolean;
}

export type ClickReportResult = { ok: true; value: ClickReportPage } | { ok: false; code: "VALIDATION_FAILED" };

// Counts clicks per link over a time window, read-only and scoped to one organization (API-045, WP-5.9). The route
// has already checked the caller's membership and reports:read; the store filters by organization as well.
export async function listClickCounts(deps: ClickReportDeps, input: ClickReportInput): Promise<ClickReportResult> {
  const from = parseInstant(input.from);
  const to = parseInstant(input.to);
  if (!from || !to || from >= to || to.getTime() - from.getTime() > MAX_CLICK_WINDOW_MS) {
    return { ok: false, code: "VALIDATION_FAILED" };
  }
  const limit = parseLimit(input.limit);
  const afterLinkId = parseCursor(input.cursor);
  if (limit === null || afterLinkId === undefined) return { ok: false, code: "VALIDATION_FAILED" };

  const asOf = deps.clock.now();
  const fetched = await deps.clicks.countByLink({
    organizationId: input.organizationId,
    from,
    to,
    afterLinkId,
    limit: limit + 1,
  });
  const hasMore = fetched.length > limit;
  const data = fetched.slice(0, limit);
  const nextCursor = hasMore ? (data.at(-1)?.linkId ?? null) : null;

  // A freshness check only needs clicks from the widest window a report can ask for.
  const since = new Date(asOf.getTime() - MAX_CLICK_WINDOW_MS);
  const latest = await deps.clicks.latestRecordedAt(input.organizationId, since);
  const dataStale =
    latest !== null && asOf.getTime() - latest.getTime() > CLICK_DATA_STALE_AFTER_MS && to.getTime() > latest.getTime();

  return { ok: true, value: { data, nextCursor, asOf, dataStale } };
}

// Only ISO-8601 instants with a time part. Date.parse also reads loose forms such as "1" or "Nov 1 2026".
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_INSTANT.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseLimit(value: unknown): number | null {
  if (value === undefined) return DEFAULT_CLICK_PAGE_SIZE;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_CLICK_PAGE_SIZE) return null;
  return value;
}

// The link ID to resume after: null when no cursor was sent, undefined when the cursor is not a link ID.
function parseCursor(value: unknown): string | null | undefined {
  if (value === undefined) return null;
  return parseId("link", value) ?? undefined;
}
