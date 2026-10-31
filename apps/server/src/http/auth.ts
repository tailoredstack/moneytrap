import { Elysia } from "elysia";

// The slice of a Better Auth instance this layer needs. Authentication (who is calling) happens in
// the Better Auth session; authorization happens in route guards, not here (AGENTS.md, moneytrap-auth).
export type AuthHandler = { handler: (request: Request) => Response | Promise<Response> };

// Forwards every method under /api/auth to Better Auth. Its own routes handle sign-up, sessions,
// verification, reset, two-factor, organizations, and API keys.
export function authRoutes(auth: AuthHandler) {
  const forward = ({ request }: { request: Request }) => auth.handler(request);
  // One route per method. In Elysia 2 a method-specific catch-all such as GET /* wins over an `.all` wildcard,
  // so `.all` would let the app shell swallow GET /api/auth/* requests.
  return new Elysia({ name: "auth" })
    .get("/api/auth/*", forward)
    .post("/api/auth/*", forward)
    .put("/api/auth/*", forward)
    .patch("/api/auth/*", forward)
    .delete("/api/auth/*", forward)
    .options("/api/auth/*", forward);
}
