# TanStack Start adoption plan

## Goals and non-goals
Decide whether SSR and a server-side BFF justify replacing the Vite SPA shell. Under the owner’s direction, Start is the BFF boundary and Elysia remains the system of record. The BFF only forwards requests and handles transport/session-cookie boundary concerns; it never implements business rules, authorizes domain actions independently, or accesses the database directly.

## Current state
`apps/web/package.json` uses Vite 8, React 19.2 and `@tanstack/react-router`; `apps/web/vite.config.ts` proxies `/api` to Elysia during development and rewrites `Origin` for Better Auth. `apps/server/src/http/auth.ts` forwards auth to Better Auth; `apps/server/src/http/guards/*` enforces policy; `apps/server/src/http/routes.ts` mounts API routes. `apps/server/src/assets.ts` serves embedded static assets, supporting the existing single-binary shape. Start is a full-stack framework with SSR, server routes and server functions; official docs distinguish same-app server functions from HTTP endpoints intended for external callers. Sources: [Start overview](https://tanstack.com/start/latest/docs/framework/react/overview), [server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions), [server routes](https://tanstack.com/start/latest/docs/framework/react/guide/server-routes).

## Options and recommendation
- **Start shell + BFF (recommended only if SSR/SEO or cookie boundary benefits justify another runtime):** loaders/functions and routes forward to Elysia, preserve its response semantics, and apply explicit allowlisted cookie/header forwarding. Server functions suit internal typed loader/action calls; route-level proxy suits transparent HTTP paths, streaming, uploads and external clients. Recommend **route-level proxy for `/api/*`** as the primary compatibility surface, with server functions only for narrowly scoped UI orchestration where typed serialization adds value. Do not expose duplicate competing API semantics.
- **Stay on SPA (recommended default until measured need):** keep Vite dev proxy and embedded static build; fewer runtimes, direct browser-to-Elysia API calls, existing Better Auth cookie/origin path, simplest single-binary packaging. Landing-page SEO and first-response content are weaker unless prerendering is introduced.

Start can render the landing page on the server and improve crawlability; authenticated dashboard SEO has little value. It adds a server deployment/runtime beside Elysia unless Start is embedded in a custom host, which complicates current single-binary packaging. Cookies require careful same-site, secure, domain, CSRF, forwarded-host and logout/session tests. In dev, the current Vite `/api` proxy would be replaced or layered with Start-to-Elysia forwarding and must not create a proxy loop.

## Steps
1. Spike landing SEO, SSR hydration and Start runtime/build output without changing production architecture (S, 3 days).
2. Prototype route proxy and server-function forwarding against Better Auth and one guarded API endpoint; test cookie lifecycle, CSRF, errors, streaming and headers (M, 1 week).
3. Measure single-binary/deploy options and dev flow; document rollback and observability (S, 3 days).
4. Owner decision gate; only then migrate route groups incrementally or retain SPA.

## Risks
Accidentally duplicating authorization or business semantics; leaking cookies or forwarding untrusted headers; breaking Better Auth Origin checks; loss of binary simplicity; cache leakage across sessions; unsupported adapter/runtime differences.

## Owner decisions (recommended defaults)
- Adopt Start? **Keep SPA unless the landing page has a measurable SEO requirement or cookie boundary needs justify server operation.**
- If adopted, proxy style? **Route-level `/api/*` pass-through for compatibility; server functions for internal, narrow BFF orchestration only.**
- Elysia ownership? **Always system of record for auth, guards and domain behavior.**
- Deployment? **Require a demonstrated packaging plan preserving operational simplicity before migration.**

## Linear packages to create
START-1 SSR/SEO and runtime spike (S); START-2 auth-cookie and proxy comparison prototype (M; depends START-1); START-3 deploy/single-binary decision record (S; depends START-1); START-4 staged shell migration (XL; only if owner approves, depends on all spikes).
