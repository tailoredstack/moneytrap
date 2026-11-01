import { describe, expect, test } from "bun:test";
import { filterStatements, formatPeriod, periodKey, type StatementRow } from "./statements";

const row = (id: string, periodStart: string, currency: string): StatementRow => ({
  id,
  periodStart,
  currency,
  status: "closed",
  total: { minor: 120410n, currency, exponent: 2 },
});

const rows: StatementRow[] = [
  row("s_1", "2026-09-01T00:00:00.000Z", "USD"),
  row("s_2", "2026-09-01T00:00:00.000Z", "EUR"),
  row("s_3", "2026-08-01T00:00:00.000Z", "USD"),
];

// UI-043: period and currency filters. Periods are read in UTC so a statement lands in the period it was closed for.
describe("statement filters and labels (UI-043)", () => {
  test("filters by period key and currency", () => {
    expect(filterStatements(rows, { period: "all", currency: "all" })).toHaveLength(3);
    expect(filterStatements(rows, { period: "2026-09", currency: "all" }).map((r) => r.id)).toEqual(["s_1", "s_2"]);
    expect(filterStatements(rows, { period: "all", currency: "USD" }).map((r) => r.id)).toEqual(["s_1", "s_3"]);
  });

  test("the period key and label come from the UTC start of the period", () => {
    expect(periodKey("2026-09-01T00:00:00.000Z")).toBe("2026-09");
    expect(formatPeriod("2026-09-01T00:00:00.000Z")).toBe("Sep 2026");
  });
});
