import { describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import type { ClickCountQuery, ClickCountRow, ClickReportStore } from "../ports/click-report-store";
import { listClickCounts, MAX_CLICK_PAGE_SIZE } from "./clicks";

const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const now = new Date("2026-11-01T12:00:00.000Z");
const window = { from: "2026-10-01T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" };

// A store that keeps every row sorted by link ID and applies the keyset cursor and limit the way Postgres does.
class FakeClickReports implements ClickReportStore {
  queries: ClickCountQuery[] = [];
  sinces: Date[] = [];
  constructor(
    private readonly rows: ClickCountRow[],
    private readonly delayMs: number | null = null,
  ) {}

  async countByLink(query: ClickCountQuery): Promise<readonly ClickCountRow[]> {
    this.queries.push(query);
    return this.rows
      .filter((row) => query.afterLinkId === null || row.linkId > query.afterLinkId)
      .sort((a, b) => (a.linkId < b.linkId ? -1 : 1))
      .slice(0, query.limit);
  }

  async recordedDelayMs(_organizationId: Id<"organization">, since: Date): Promise<number | null> {
    this.sinces.push(since);
    return this.delayMs;
  }
}

const DAY = 24 * 60 * 60 * 1000;
const clock = { now: () => now };
const L1 = "lnk_01arz3ndektsv4rrffq69g5fa1";
const L2 = "lnk_01arz3ndektsv4rrffq69g5fa2";
const L3 = "lnk_01arz3ndektsv4rrffq69g5fa3";
const rows = [
  { linkId: L1, clicks: 3 },
  { linkId: L2, clicks: 1 },
  { linkId: L3, clicks: 7 },
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
    expect(first.value.data.map((row) => row.linkId)).toEqual([L1, L2]);
    expect(first.value.nextCursor).toBe(L2);

    const second = await listClickCounts(
      { clicks: store, clock },
      { organizationId: orgA, ...window, limit: 2, cursor: first.value.nextCursor },
    );
    if (!second.ok) throw new Error("expected a page");
    expect(second.value.data.map((row) => row.linkId)).toEqual([L3]);
    expect(second.value.nextCursor).toBeNull();
    expect(store.queries[1]?.afterLinkId).toBe(L2);
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

  test("refuses loose date forms that Date.parse would accept", async () => {
    const deps = { clicks: new FakeClickReports(rows), clock };
    const loose = ["1", "Nov 1 2026", "2026-11-01", "2026-11-01 10:00:00Z", "2026-13-40T00:00:00Z"];
    for (const from of loose) {
      expect(await listClickCounts(deps, { organizationId: orgA, from, to: window.to })).toEqual({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });

  test("refuses calendar dates that roll over and clock times out of range", async () => {
    const deps = { clicks: new FakeClickReports(rows), clock };
    const impossible = [
      "2026-02-31T00:00:00Z",
      "2026-04-31T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-11-01T24:00:00Z",
      "2026-11-01T10:60:00Z",
      "2026-11-01T10:00:60Z",
    ];
    for (const from of impossible) {
      expect(await listClickCounts(deps, { organizationId: orgA, from, to: window.to })).toEqual({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });

  test("accepts a leap day", async () => {
    const result = await listClickCounts(
      { clicks: new FakeClickReports([]), clock },
      { organizationId: orgA, from: "2028-02-29T00:00:00Z", to: "2028-03-01T00:00:00Z" },
    );
    expect(result.ok).toBe(true);
  });

  test("refuses a page size outside 1 to the maximum, and a cursor that is not a link ID", async () => {
    const deps = { clicks: new FakeClickReports(rows), clock };
    const bad: Array<Record<string, unknown>> = [
      { limit: 0 },
      { limit: MAX_CLICK_PAGE_SIZE + 1 },
      { limit: 1.5 },
      { limit: "10" },
      { cursor: "" },
      { cursor: "null" },
      { cursor: "x".repeat(201) },
      { cursor: 7 },
      { cursor: "org_01arz3ndektsv4rrffq69g5fav" },
    ];
    for (const extra of bad) {
      expect(await listClickCounts(deps, { organizationId: orgA, ...window, ...extra })).toEqual({
        ok: false,
        code: "VALIDATION_FAILED",
      });
    }
  });

  test("marks data stale when clicks recorded in the last day arrived more than a day late and the window reaches that day", async () => {
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, 2 * DAY), clock },
      { organizationId: orgA, from: "2026-10-31T00:00:00.000Z", to: "2026-11-01T12:00:00.000Z" },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(true);
  });

  test("a quiet organization with no recent clicks is not stale", async () => {
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, null), clock },
      { organizationId: orgA, ...window },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(false);
  });

  test("current ingestion is not stale, even for an organization that is quiet", async () => {
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, 30 * 1000), clock },
      { organizationId: orgA, ...window },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(false);
  });

  test("does not mark data stale when the window ends before the stale span", async () => {
    const result = await listClickCounts(
      { clicks: new FakeClickReports(rows, 2 * DAY), clock },
      { organizationId: orgA, from: "2026-09-01T00:00:00.000Z", to: "2026-10-01T00:00:00.000Z" },
    );
    if (!result.ok) throw new Error("expected a page");
    expect(result.value.dataStale).toBe(false);
  });

  test("the delay lookup covers only the last stale span", async () => {
    const store = new FakeClickReports(rows);
    await listClickCounts({ clicks: store, clock }, { organizationId: orgA, ...window });
    expect(store.sinces[0]?.getTime()).toBe(now.getTime() - DAY);
  });
});
