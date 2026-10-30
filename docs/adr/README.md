# Architecture decision records

Each ADR records one decision, the evidence behind it, and a fallback. Status is `Accepted` or `Rejected`, with the date. Decisions come from Blueprint §11. Spike results are in `spikes/`.

| ADR | Decision | Status |
|---|---|---|
| [ADR-001](ADR-001-bun-runtime-and-toolchain.md) | Bun as runtime, package manager, test runner, and binary builder | Accepted, 2026-10-31 |
| [ADR-002](ADR-002-elysia-2-http-layer.md) | Elysia 2 as HTTP layer, behind an adapter boundary | Accepted, 2026-10-31 |
| [ADR-003](ADR-003-postgres-kysely-migrations.md) | Postgres with Kysely; migrations statically bundled | Accepted, 2026-10-31 |
| [ADR-004](ADR-004-outbox-to-redis-queue.md) | Postgres outbox relayed to a Redis queue; at-least-once with consumer dedupe | Accepted, 2026-10-31 |
| [ADR-005](ADR-005-money-bigint-minor-units.md) | Money as `bigint` minor units with largest-remainder allocation | Accepted, 2026-10-31 |
| [ADR-006](ADR-006-actions-and-queries.md) | Actions and queries; pure domain; no repositories; no DI container | Accepted, 2026-10-31 |
| [ADR-007](ADR-007-redirect-route-view.md) | Redirect route view with freshness bound and version check | Accepted, 2026-10-31 (revised) |
| [ADR-008](ADR-008-frontend-bundler-vite.md) | Frontend bundler: Vite | Accepted, 2026-10-31 |
| [ADR-009](ADR-009-better-auth.md) | Better Auth for authentication, organizations, two-factor, and API keys | Accepted, 2026-10-31 |
| [ADR-010](ADR-010-frontend-stack.md) | shadcn/ui, TanStack Router, Query, Table, and Form | Accepted, 2026-10-31 |
| [ADR-011](ADR-011-defer-oauth-for-user-delegated-access.md) | Defer OAuth 2.0 for user-delegated access; M7 ships org-scoped API keys | Accepted, 2026-10-31 (deferred) |

ADR-012 (network adapter choice) and ADR-013 (Optimize consent) are reserved by the implementation plan. Their work packages write them.
