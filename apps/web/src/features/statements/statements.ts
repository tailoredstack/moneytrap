import type { Money } from "../finance-ops/money";

export type StatementStatus = "closed" | "open";

export interface StatementRow {
  id: string;
  // The first instant of the period, in UTC.
  periodStart: string;
  currency: string;
  status: StatementStatus;
  total: Money;
}

export interface StatementFilter {
  // "YYYY-MM" from periodKey, or "all".
  period: string | "all";
  currency: string | "all";
}

export const NO_STATEMENT_FILTER: StatementFilter = { period: "all", currency: "all" };

export const STATUS_LABEL: Record<StatementStatus, string> = { closed: "Closed", open: "Open" };

// The period is read in UTC, so a statement lands in the month it was closed for regardless of the viewer's zone.
export function periodKey(periodStart: string): string {
  const date = new Date(periodStart);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function formatPeriod(periodStart: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(periodStart),
  );
}

export function filterStatements(rows: readonly StatementRow[], filter: StatementFilter): StatementRow[] {
  return rows.filter(
    (row) =>
      (filter.period === "all" || periodKey(row.periodStart) === filter.period) &&
      (filter.currency === "all" || row.currency === filter.currency),
  );
}
