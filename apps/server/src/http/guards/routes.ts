import { parseId } from "@moneytrap/domain";
import type { Guard } from "./policy";

// The route permission table (Blueprint §3.1). Keys are `METHOD /path` using the route pattern Elysia reports.
// A served route with no entry is refused at runtime and fails the coverage test; an entry for a route that is
// not served fails the same test.
export const ROUTE_GUARDS: Readonly<Record<string, Guard>> = {
  "GET /healthz": { access: "public" },
  "GET /readyz": { access: "public" },
  "GET /api/health": { access: "public" },
  // The web shell and its assets. API paths that match nothing answer 404 inside the handler.
  // The visitor redirect (UC13). Public, because the visitor has no account; the route view decides every answer.
  "GET /r/:token": { access: "public" },
  "GET /*": { access: "public" },

  ...Object.fromEntries(
    (["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const).map((method) => [
      `${method} /api/auth/*`,
      { access: "delegated", reason: "Better Auth checks the caller and its organization access-control statements" },
    ]),
  ),

  "GET /api/sessions": { access: "session" },
  "DELETE /api/sessions/:id": { access: "session" },
  "PUT /api/password": { access: "session" },
  // Click analytics for one organization (API-045). Membership and reports:read are checked against the path's org.
  "GET /api/organizations/:organizationId/reports/clicks": {
    access: "permission",
    permission: "reports:read",
    scope: async (params) => {
      const organizationId = parseId("organization", params.organizationId);
      return organizationId ? { organizationId } : null;
    },
  },
  // Asks for approval of a program for one property (API-035, WP-4.10). The organization is in the path, so the guard
  // can check membership and catalog:write before the handler runs. The body never names the organization.
  "POST /api/organizations/:organizationId/programs/:programId/request-approval": {
    access: "permission",
    permission: "catalog:write",
    scope: async (params) => {
      const organizationId = parseId("organization", params.organizationId);
      return organizationId ? { organizationId } : null;
    },
  },
};
