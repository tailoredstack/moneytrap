import { Elysia } from "elysia";

// The slice of a Better Auth instance this layer needs. Authentication (who is calling) happens in
// the Better Auth session; authorization happens in route guards, not here (AGENTS.md, moneytrap-auth).
export type AuthHandler = { handler: (request: Request) => Response | Promise<Response> };

// Forwards every method under /api/auth to Better Auth. Its own routes handle sign-up, sessions,
// verification, reset, two-factor, organizations, and API keys.
export function authRoutes(auth: AuthHandler) {
  return new Elysia({ name: "auth" }).all("/api/auth/*", ({ request }) => auth.handler(request));
}
