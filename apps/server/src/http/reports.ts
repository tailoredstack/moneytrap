import { type ClickReportDeps, listClickCounts } from "@moneytrap/app/src/reporting/clicks";
import { type Id, parseId } from "@moneytrap/domain";
import { Elysia } from "elysia";
import { errorResponse } from "./error-map";
import { guard, type PrincipalResolver } from "./guards/enforce";
import { requestIdOf } from "./request-id";

export const CLICK_REPORT_PATH = "/api/organizations/:organizationId/reports/clicks";
// The key the guard table uses for this route: the method and the path.
export const CLICK_REPORT_KEY = `GET ${CLICK_REPORT_PATH}`;

export interface ReportWiring extends ClickReportDeps {
  principal: PrincipalResolver;
}

// Click counts per link for one organization (API-045, WP-5.9). The guard checks membership and reports:read against the
// organization in the path. The query runs read-only and filters by that same organization.
// Mounted only when the composition root supplies the stores. Without them the route is not served at all.
export function reportRoutes(wiring?: ReportWiring) {
  const app = new Elysia({ name: "reports" });
  if (!wiring) return app;
  const { principal, ...deps } = wiring;
  return app.get(CLICK_REPORT_PATH, guard(CLICK_REPORT_KEY, principal), async ({ params, query, request, set }) => {
    const organizationId = parseId("organization", params.organizationId) as Id<"organization">;
    const result = await listClickCounts(deps, {
      organizationId,
      from: query.from,
      to: query.to,
      cursor: query.cursor,
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
    if (!result.ok) {
      const { status, body } = errorResponse(result.code, requestIdOf(request), "Request failed");
      set.status = status;
      return body;
    }
    const page = result.value;
    return {
      data: page.data.map((row) => ({ link_id: row.linkId, clicks: row.clicks })),
      next_cursor: page.nextCursor,
      as_of: page.asOf.toISOString(),
      data_stale: page.dataStale,
    };
  });
}
