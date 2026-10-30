# ADR-002: Elysia 2 as the HTTP layer, behind an adapter boundary

- Status: Accepted, 2026-10-31 (pre-release pins; see Risks)
- Date: 2026-10-31
- Spike: WP-0.7 (library compatibility), WP-0.5 (binary shape)

## Context

Blueprint §1 selects Elysia 2 for type-safe routes, TypeBox schemas, and built-in OpenAPI output. Elysia 2 has no stable release yet. The compatibility spike used `elysia@2.0.0-rc.1`, and the only 2.x build of `@elysiajs/openapi` is `2.0.0-exp.0`.

## Decision

Use Elysia `2.0.0-rc.1` in `apps/server`, pinned exactly with no caret. Use `@elysiajs/openapi@2.0.0-exp.0`, pinned exactly, for `GET /openapi/json`. HTTP route code stays in `apps/server/src/http/`. Domain and app code never import Elysia; the boundary rules enforce this (`app-no-redis-or-elysia` and `domain-no-framework-imports`).

## Evidence

WP-0.7 results, the same checks under `bun test` and in the compiled binary:

- Body validation maps to `VALIDATION_FAILED`, and domain errors map to status and code.
- Plugin hooks stay local and do not leak to other routes.
- The OpenAPI route lists the app's routes.
- Better Auth's handler mounts through Elysia, and sign-up and session work through the mount.

Route hooks come before the handler in Elysia 2 (`.post(path, hook, handler)`). The 1.x order throws at registration.

## Risks

- The rc API may still change before 2.0.0.
- `@elysiajs/openapi` is experimental. A route-level change in it can break generated documentation without breaking routes.
- The redirect latency numbers come from Spike B, which ran on Elysia 1.4.30, not Elysia 2. Elysia 2 has no latency measurement yet. WP-5.4 must measure the redirect route on this framework.

## Fallback

If rc.1 breaks, or 2.0.0 changes route semantics in a way the boundary cannot absorb, pin Elysia 1.4.x in `apps/server`. Spike B measured that line. If the OpenAPI plugin breaks, generate the document from the TypeBox schemas in `packages/contracts`. The HTTP adapter boundary keeps either change inside `apps/server/src/http/`.

When Elysia 2.0.0 is released, upgrade in its own pull request and rerun the WP-0.7 checks.
