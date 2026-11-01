import { type Static, Type } from "@sinclair/typebox";
import { ApiError, apiRequest } from "../../api/client";
import type { LoadState } from "../directory/load-state";

// The WP-5.9 response for GET /api/organizations/:id/reports/clicks (API-045). Mirrors the server's reports route.
export const ClickReportResponseSchema = Type.Object({
  data: Type.Array(Type.Object({ link_id: Type.String(), clicks: Type.Integer({ minimum: 0 }) })),
  next_cursor: Type.Union([Type.String(), Type.Null()]),
  as_of: Type.String(),
  data_stale: Type.Boolean(),
});

export type ClickReportResponse = Static<typeof ClickReportResponseSchema>;

// The window the screen asks for. Both ends are ISO-8601 instants with a time part, as the server requires.
export const CLICK_WINDOW_DAYS = 7;

export function clickWindow(now: Date): { from: string; to: string } {
  const from = new Date(now.getTime() - CLICK_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: now.toISOString() };
}

// Reads one page of click counts for an organization. The server decides what the caller may see.
export function fetchClickReport(
  organizationId: string,
  input: { from: string; to: string; cursor?: string | undefined },
): Promise<ClickReportResponse> {
  const params = new URLSearchParams({ from: input.from, to: input.to });
  if (input.cursor) params.set("cursor", input.cursor);
  return apiRequest(
    ClickReportResponseSchema,
    `/organizations/${encodeURIComponent(organizationId)}/reports/clicks?${params.toString()}`,
  );
}

export interface ClickRow {
  linkId: string;
  clicks: number;
}

export interface ClickReportData {
  rows: ClickRow[];
  asOf: string;
  stale: boolean;
  nextCursor: string | null;
}

// A missing organization is shown as not found, not as forbidden (SKELETONS §10.2).
export type ClickReportState = LoadState<ClickReportData> | { kind: "not_found" };

export function readyState(response: ClickReportResponse): ClickReportState {
  return {
    kind: "ready",
    data: {
      rows: response.data.map((row) => ({ linkId: row.link_id, clicks: row.clicks })),
      asOf: response.as_of,
      stale: response.data_stale,
      nextCursor: response.next_cursor,
    },
  };
}

// Maps a failed request to a screen state. A failure never becomes a zero count: the numbers simply are not shown.
export function failedState(error: unknown): ClickReportState {
  if (error instanceof ApiError) {
    if (error.status === 403) return { kind: "forbidden" };
    if (error.status === 404) return { kind: "not_found" };
    return { kind: "error", ref: error.correlationId || undefined };
  }
  return { kind: "error" };
}
