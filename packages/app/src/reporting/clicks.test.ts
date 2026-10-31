import { describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import type { ClickCountQuery, ClickCountRow, ClickReportStore } from "../ports/click-report-store";
import { CLICK_DATA_STALE_AFTER_MS, listClickCounts, MAX_CLICK_PAGE_SIZE } from "./clicks";

const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const now = new Date("2026-11-01T12:00:00.000Z");
const window = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

// A store that keeps every row sorted by link ID and applies the keyset cursor and limit the way Postgres does.
class FakeClickReports implements ClickReportStore {
  queries: ClickCountQuery[] = [];
  constructor(
    private readonly rows: ClickCountRow[],
    private readonly latest: Date | null = null,
  ) {}

  async countByLink(query: ClickCountQuery): Promise<readonly ClickCountRow[]> {
    this.queries.push(query);
    return this.rows
      .filter((row) => query.afterLinkId === null || row.linkId > query.afterLinkId)
      .sort((a, b) => (a.linkId < b.linkId ? -1 : 1))
      .slice(0, query.limit);
  }

  async latestRecordedAt(): Promise<Date | null> {
    return this.latest;
  }
}

const clock = { now: () => now };
const rows = [
  { linkId: "lnk_a", clicks: 3 },
  { linkId: "lnk_b", clicks: 1 },
  { linkId: "lnk_c", clicks: 7 },
];

describe("click counts per link (API-045, WP-5.9)", () => {
  test("counts each link in the window and reports as_of from the clock", async () => {
    const store = new FakeClickReports(rows);
    const result = await listClickCounts({ clicks: store, clock }, { organizationId: orgA, ...window });

    expect(result).toEqual({
      ok: true,
      value: { data: rows, nextCursor: null, asOf: now, dataStale: false },
    });
    expect(store.queries[0]).toEqual({
      organizationId: orgA,
      from: new Date(window.from),
      to: new Date(window.to),
      afterLinkId: null,
      limit: 51,
    });
  });

  test("pages by link ID: the next cursor resumes after the last link of the page", async () => {
    const store = new FakeClickReports(rows);
    const first = await listClickCounts({ clicks: store, clock }, { organizationId: orgA, ...window, limit: 2 });
    if (!first.ok) throw new Error("expected a page");
    expect(first.value.data.map((row) => row.linkId)).toEqual(["lnk_a", "lnk_b"]);
    expect(first.value.nextCursor).toBe("lnk_b");

    const second = await listClickCounts(
      { clicks: store, clock },
      { organizationId: orgA, ...window, limit: 2, cursor: first.value.nextCursor },
    );
    if (!second.ok) throw new Error("expected a page");
    expect(second.value.data.map((row) => row.linkId)).toEqual(["lnk_c"]);
    expect(second.value.nextCursor).toBeNull();
    expect(store.queries[1]?.afterLinkId).toBe("lnk_b");
  });

  test("an empty window returns no rows and no cursor", async () => {
    const result = await listClickCounts(
      { clicks: new FakeClickReports([]), clock },
      { organizationId: orgA, ...window },
    );
    expect(result).toEqual({ ok: true, value: { data: [], nextCursor: null, asOf: now, dataStale: false } });
  });

  test("refuses a window that is empty, reversed, or longer than a year", async () => {
    const deps = { clicks: new FakeClickReports(rows), clock };
    const bad = [
      { from: window.to, to: window.from },
      { from: window.from, to: window.from },
      { from: "2024-01-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" },
      { from: "not a date", to: window.to },
      { from: 1730000000000, to: window.to },
    ];
    for (const input of bad) {
      expect(await listClickCounts(deps, { organizationId: orgA, ...input })).toEqual({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });

  test("refuses a page size outside 1 to the maximum, and an empty or oversized cursor", async () => {
    const deps = { clicks: new FakeClickReports(rows), clock };
    const bad: Array<Record<string, unknown>> = [
      { limit: 0 },
      { limit: MAX_CLICK_PAGE_SIZE + 1 },
      { limit: 1.5 },
      { limit: "10" },
      { cursor: "" },
      { cursor: "x".repeat(201) },
      { cursor: 7 },
    ];
    for (const extra of bad) {
      expect(await listClickCounts(deps, { organizationId: orgA, ...window, ...extra })).toEqual({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });

  test("marks data stale when the newest click is older than the stale window and the window reaches past it", async () => {
    const latest = new Date(now.getTime() - CLICK_DATA_STALE_AFTER_MS - 60_000);
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, latest), clock },
      { organizationId: orgA, ...window },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(true);
  });

  test("does not mark data stale when the newest click is recent", async () => {
    const latest = new Date(now.getTime() - 60_000);
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, latest), clock },
      { organizationId: orgA, ...window },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(false);
  });

  test("does not mark data stale when the window ends before the newest click", async () => {
    const latest = new Date("2026-10-15T00:00:00.000Z");
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, latest), clock },
      { organizationId: orgA, from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(false);
  });
});
