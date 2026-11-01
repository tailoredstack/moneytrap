import { describe, expect, test } from "bun:test";
import { EXCEPTION_PAGE_SIZE, type ExceptionRow, filterExceptions, NO_EXCEPTION_FILTER, pageOf } from "./exceptions";

function rows(count: number): ExceptionRow[] {
  return Array.from({ length: count }, (_, index) => ({
    conversionId: `c_${index}`,
    reason: index % 2 === 0 ? "no_click" : "window",
    status: index % 5 === 0 ? "resolved" : "open",
    amount: null,
  }));
}

// TP-W6-033. Filters and pages apply to the whole exception list, not only to the rows on screen.
describe("exception filters and paging (UI-040, TP-W6-033)", () => {
  test("the default filter shows open exceptions of every reason", () => {
    const all = rows(10);
    const shown = filterExceptions(all, NO_EXCEPTION_FILTER);
    expect(shown.every((row) => row.status === "open")).toBe(true);
    expect(shown.length).toBe(all.filter((row) => row.status === "open").length);
  });

  test("filters by reason", () => {
    const shown = filterExceptions(rows(10), { reason: "window", status: "all" });
    expect(shown.length).toBe(5);
    expect(shown.every((row) => row.reason === "window")).toBe(true);
  });

  test("pages 300 items in fixed pages and clamps out-of-range pages", () => {
    const all = rows(300);
    const first = pageOf(all, 1);
    expect(first.rows.length).toBe(EXCEPTION_PAGE_SIZE);
    expect(first.pageCount).toBe(12);
    expect(first.hasPrevious).toBe(false);
    expect(first.hasNext).toBe(true);
    const last = pageOf(all, 99);
    expect(last.page).toBe(12);
    expect(last.rows.length).toBe(300 - 11 * EXCEPTION_PAGE_SIZE);
    expect(last.hasNext).toBe(false);
  });

  test("an empty list is one empty page", () => {
    const empty = pageOf([], 3);
    expect(empty.page).toBe(1);
    expect(empty.pageCount).toBe(1);
    expect(empty.rows).toEqual([]);
  });
});
