# TanStack Start adoption plan (BFF)

## Owner decision

Start is the backend-for-frontend (BFF) layer. Elysia stays the system of record for authentication, guards, and domain logic. This plan is written on that basis and does not reopen it. The open questions below are how the BFF forwards requests and where it runs.

## Goals

- Put a Start server between the browser and Elysia. It forwards API traffic, owns the cookie and session boundary at the web origin, and serves the web shell.
- Keep every business rule, permission check, and money calculation in Elysia.

## Non-goals

- No business rules, authorization decisions, or money math in Start.
- No database, Redis, or outbox access from Start.
- No change to Better Auth's ownership of credentials, sessions, and MFA.
- No SSR for authenticated screens in phase 1. Server rendering is optional for the public landing page, and it is decided after the spike.

## Current state

- `apps/web/package.json`: Vite 8, React 19.2, `@tanstack/react-router`, no Start packages yet.
- `apps/web/vite.config.ts`: dev proxy forwards `/api` to Elysia and rewrites `Origin` to the server origin, because Better Auth checks it.
- `apps/web/src/api/client.ts`: `apiRequest` calls `/api${path}` with `credentials: "include"` and checks responses against `packages/contracts`.
- `apps/server/src/http/routes.ts`: mounts auth, session, report, approval, and redirect routes under `/api`, with a guard on every route. `GET /*` serves embedded web assets and returns 404 for unknown `/api/*` paths.
- `apps/server/src/http/auth.ts` and `apps/server/src/auth/config.ts`: Better Auth with `trustedOrigins` (the base URL plus `TRUSTED_ORIGINS`) and `trustedProxies`.
- `apps/server/src/assets.ts`: serves the embedded Vite output with `Bun.file`. The binary reads nothing from disk at runtime (Blueprint §1).

Start facts checked against its docs:
- Server functions are created with `createServerFn()`, have `.validator()` and `.handler()`, and read the request with `getRequest()` and `getRequestHeader()`. Thrown `redirect()` and `notFound()` are supported.
- Server functions have built-in CSRF protection. The middleware checks `Sec-Fetch-Site`, `Origin`, or `Referer`, and rejects requests that carry none of them unless the app opts out.
- Server routes are the documented way to expose HTTP endpoints to outside callers.
- SPA mode prerenders only a shell (`/_shell.html`) and needs the host to rewrite non-asset paths to it.
- Documented hosting targets include `node-server`, `bun`, `nitro`, and several platforms. The docs do not describe single-binary output.
- I did not verify that Start 1.0 is released, which version to pin, or whether a Start server handler can be mounted inside another process. The TanStack announcement I read is the September 2025 release-candidate post. START-1 must confirm these before any code.

## Options

Both options run on the same boundary rules below. The difference is how the request leaves Start.

| | (A) Server-function forwarding | (B) Route-level `/api/*` proxy |
|---|---|---|
| How it works | UI calls a `createServerFn` whose handler calls Elysia with `fetch` and returns the parsed body | A Start server route under `/api/*` passes the request (method, query, body stream, allowed headers) to Elysia and returns Elysia's response unchanged |
| Typing | Typed by `packages/contracts` on each function | Typed at the contract layer already used by `apiRequest`; the proxy has no types of its own |
| Better Auth flows (`/api/auth/*`, `Set-Cookie`) | Awkward. Each function must copy `Set-Cookie` back by hand | Passes `Set-Cookie`, redirects, and status codes through unchanged |
| Uploads (bulk CSV), streaming, large responses | Needs a per-function design | Passes the body stream through |
| Error envelope | Must be re-mapped per function, which risks drift | Passed through unchanged |
| CSRF | Built in (server function middleware) | Not built in. Start must check `Origin`/`Sec-Fetch-Site` on state-changing methods, or rely on Better Auth's origin check |
| Surface on the web origin | Only the functions the UI calls | Every `/api/*` path becomes reachable from the web origin, so the allow-list must be explicit |
| Boilerplate | One function per call | One route |
| Duplicate-semantics risk | Higher. Each function can start to shape responses | Lower. The proxy does not interpret responses |

**Recommendation: (B) route-level `/api/*` proxy as the only transport for API traffic.** It keeps Elysia's status codes, error envelope, Better Auth cookie flow, and uploads intact, and it avoids a second copy of each endpoint. Server functions are limited to reads the shell needs before render, such as the session check that route guards use as UX. Those calls use the same forwarding helper as the proxy and never reimplement it. Server functions do not handle mutations, money, or permissions.

## BFF rules

The BFF must never:
- Implement or duplicate business rules, state transitions, eligibility, allocation, ledger math, or permission checks. Elysia's guards decide.
- Import `packages/app`, `packages/domain`, the adapters, or Kysely/`pg`/Redis clients. Its only workspace import is `packages/contracts`, which the dependency-cruiser rules should enforce.
- Read or write Postgres, Redis, or the outbox directly.
- Mint, store, or validate its own session or token. Better Auth owns the session cookie, and the BFF forwards it.
- Log, persist, or cache `Cookie`, `Set-Cookie`, one-time tokens, or recovery links. Authenticated responses use `private` and `no-store`.
- Rewrite, drop, or reinterpret Elysia error codes or status codes.
- Treat a client-side route guard as authorization. The UI catalog requires the server to check every operation again.

The BFF must always:
- Forward only an allow-listed set of request headers, plus `Cookie`, the client IP through the existing `trustProxy` setting, and the original `Origin`.
- Pass `Set-Cookie` from Elysia back to the browser unchanged, and strip hop-by-hop headers in both directions.
- Keep Elysia's response body and status unchanged.

## Cookie, origin, and session boundary

- The browser talks only to the web origin, so the Better Auth cookie is first-party. Its `SameSite`, `Secure`, and domain attributes are set by Elysia and checked in tests.
- Default decision: forward the browser's original `Origin` to Elysia and add the web origin to `TRUSTED_ORIGINS`. This replaces the current Vite rewrite of `Origin` to the server origin. The rewrite would hide the real origin from Better Auth's check.
- Logout and session expiry are tested through the proxy, including `Set-Cookie` clearing the cookie.

## Deployment shape (open)

Start needs a server runtime. The single-binary model (Blueprint §1) has Elysia serving the embedded assets. Two shapes are possible:
- **In-binary:** Start's server handler is mounted in the Elysia process. Not verified. START-3 must test it under `bun build --compile`.
- **Separate BFF process:** a Start server runs beside the binary, and Elysia is reached over a private address. This changes the deploy from one process to two and needs an ADR update to ADR-008, ADR-010, and Blueprint §1.

## Steps

1. Confirm the Start version and rendering mode against its release notes, and pin it (S, 2 days). Owner: START-1.
2. Prototype the route-level proxy against Better Auth sign-in, session read, one guarded endpoint, an error response, and a large upload. Check cookies, origin handling, CSRF, and streaming (M, 1 week). Owner: START-2.
3. Prototype one server-function read with the same forwarding helper, and compare boilerplate and typing with the proxy (S, 2 days). Owner: START-2.
4. Test the deployment shape in both forms against `bun build --compile` and the single-binary test (M, 1 week). Owner: START-3.
5. Write the BFF cookie and origin test suite as a conformance group: login, session read, logout, expired session, CSRF rejection, error pass-through, no cache on private responses (S, 3 days). Owner: START-4.
6. Owner gate: choose the deployment shape and proxy style. Only then migrate route groups one at a time, with the SPA as the fallback (XL). Owner: START-5.

## Risks

- Duplicated semantics if a server function starts to shape or check responses.
- Cookie leakage: forwarding an unallowed header or caching a private response across sessions.
- Origin mismatch breaking Better Auth's check after the Vite rewrite is removed.
- A proxy loop if the BFF forwards to an Elysia address that resolves back to the BFF.
- Losing the single-binary deploy if Start needs its own process.
- Unverified Start 1.0 status and in-binary mounting.

## Decisions for the owner

- **Proxy style.** Recommended: route-level `/api/*` proxy as the only API transport. Server functions only for shell reads that reuse the same helper. Alternative: server functions for all calls.
- **Deployment shape.** Recommended: test in-binary first, and accept a separate BFF process only if the spike fails, with an ADR update. Alternative: separate process from the start.
- **Origin handling.** Recommended: forward the original `Origin` and add the web origin to `TRUSTED_ORIGINS`. Alternative: keep the Vite-style rewrite.
- **Rendering.** Recommended: SPA shell with prerendered `/_shell.html` for the landing page. No SSR until a measured SEO requirement exists. Alternative: SSR for the landing page.
- **Pin version.** Recommended: pin the exact Start release that START-1 confirms. Do not track a floating tag.

## Linear packages to create

Not created. Proposed:
- **START-1** Confirm Start release, pin, and rendering mode (S).
- **START-2** Route-level proxy prototype and server-function comparison (M; depends on START-1).
- **START-3** Deployment shape spike: in-binary versus separate BFF process (M; depends on START-1).
- **START-4** BFF cookie, origin, CSRF, and error pass-through test suite (S; depends on START-2).
- **START-5** Staged route migration behind the owner gate (XL; depends on START-2, START-3, START-4, and owner approval).
