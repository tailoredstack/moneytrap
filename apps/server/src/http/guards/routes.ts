import type { Guard } from "./policy";

// The route permission table (Blueprint §3.1). Keys are `METHOD /path` using the route pattern Elysia reports.
// A served route with no entry is refused at runtime and fails the coverage test; an entry for a route that is
// not served fails the same test.
export const ROUTE_GUARDS: Readonly<Record<string, Guard>> = {
  "GET /healthz": { access: "public" },
  "GET /readyz": { access: "public" },
  "GET /api/health": { access: "public" },
  // The web shell and its assets. API paths that match nothing answer 404 inside the handler.
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
};
