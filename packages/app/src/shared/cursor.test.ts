import { describe, expect, test } from "bun:test";
import { keysetPage } from "./cursor";

type Row = { id: string; createdAt: string };
const byCreatedAt = (row: Row) => row.createdAt;

const rows: Row[] = [
  { id: "c", createdAt: "2026-01-02" },
  { id: "a", createdAt: "2026-01-01" },
  { id: "b", createdAt: "2026-01-02" },
  { id: "d", createdAt: "2026-01-03" },
];

describe("keysetPage", () => {
  test("orders by sort key then id, so ties have a stable order", () => {
    const page = keysetPage(rows, { limit: 10, sortKey: byCreatedAt });
    expect(page.items.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(page.nextPosition).toBeNull();
  });

  test("returns a position for the last item when more rows remain", () => {
    const page = keysetPage(rows, { limit: 2, sortKey: byCreatedAt });
    expect(page.items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(page.nextPosition).toEqual({ sort: "2026-01-02", id: "b" });
  });

  test("continues strictly after the position with no gaps or duplicates", () => {
    const first = keysetPage(rows, { limit: 2, sortKey: byCreatedAt });
    const second = keysetPage(rows, { limit: 2, after: first.nextPosition ?? undefined, sortKey: byCreatedAt });
    expect(second.items.map((r) => r.id)).toEqual(["c", "d"]);
    expect(second.nextPosition).toBeNull();
  });

  test("a row inserted before the position does not shift later pages", () => {
    const first = keysetPage(rows, { limit: 2, sortKey: byCreatedAt });
    const withNew = [...rows, { id: "z", createdAt: "2025-12-31" }];
    const second = keysetPage(withNew, { limit: 2, after: first.nextPosition ?? undefined, sortKey: byCreatedAt });
    expect(second.items.map((r) => r.id)).toEqual(["c", "d"]);
  });

  test("orders by code units, matching a SQL ORDER BY under the C collation", () => {
    const mixed: Row[] = [
      { id: "x", createdAt: "b" },
      { id: "y", createdAt: "B" },
      { id: "z", createdAt: "a" },
    ];
    const page = keysetPage(mixed, { limit: 10, sortKey: byCreatedAt });
    expect(page.items.map((r) => r.id)).toEqual(["y", "z", "x"]);
  });

  test("does not mutate the input array", () => {
    const copy = [...rows];
    keysetPage(rows, { limit: 2, sortKey: byCreatedAt });
    expect(rows).toEqual(copy);
  });
});
