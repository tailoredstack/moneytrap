import type { Money } from "./money";

export const EXCEPTION_PAGE_SIZE = 25;

// The reasons a conversion can fail to match (WP-6.7). `window` is a conversion outside the click window.
export type ExceptionReason = "no_click" | "window";
export type ExceptionStatus = "open" | "resolved";

export interface ExceptionRow {
  conversionId: string;
  reason: ExceptionReason;
  status: ExceptionStatus;
  amount: Money | null;
}

export interface ExceptionFilter {
  reason: ExceptionReason | "all";
  status: ExceptionStatus | "all";
}

// The queue opens on open exceptions, as SKELETONS §6.3 shows.
export const NO_EXCEPTION_FILTER: ExceptionFilter = { reason: "all", status: "open" };

export const REASON_LABEL: Record<ExceptionReason, string> = {
  no_click: "No matching click",
  window: "Outside window",
};

export const STATUS_LABEL: Record<ExceptionStatus, string> = { open: "Open", resolved: "Resolved" };

export function filterExceptions(rows: readonly ExceptionRow[], filter: ExceptionFilter): ExceptionRow[] {
  return rows.filter(
    (row) =>
      (filter.reason === "all" || row.reason === filter.reason) &&
      (filter.status === "all" || row.status === filter.status),
  );
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageCount: number;
  total: number;
  from: number;
  to: number;
  hasPrevious: boolean;
  hasNext: boolean;
}

// Pages a list that is already in memory. An out-of-range page clamps to the nearest real page.
export function pageOf<T>(items: readonly T[], requested: number, size = EXCEPTION_PAGE_SIZE): Page<T> {
  const pageCount = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(Math.max(1, requested), pageCount);
  const start = (page - 1) * size;
  const rows = items.slice(start, start + size);
  return {
    rows,
    page,
    pageCount,
    total: items.length,
    from: rows.length === 0 ? 0 : start + 1,
    to: start + rows.length,
    hasPrevious: page > 1,
    hasNext: page < pageCount,
  };
}
