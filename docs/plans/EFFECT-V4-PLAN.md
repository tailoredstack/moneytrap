# Effect v4 adoption plan

## Goals and non-goals
Evaluate targeted Effect adoption for typed failure, resource safety, concurrency and long-running workflows. This is **adoption**, not a migration: repository search finds no Effect package dependency or Effect imports today. Keep existing public domain/API contracts stable. Do not wrap all TypeScript in Effect for uniformity.

## Current state
`packages/app/src/ports/*` defines Promise-based ports; use cases in `packages/app/src/*` are plain TypeScript. The blueprint describes Postgres outbox rows committed with domain changes and a Redis-backed relay/worker (`docs/MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md`, §§4, 6); payout provider boundary is `packages/app/src/ports/payout-provider.ts`. Dependencies and implementation details remain adapter-owned. Effect’s official release page says Effect 4.0 shipped stable on October 1, 2026; v4 includes core `Effect`, `Context.Service`, `Layer`, `Scope`, `Stream`, and Schema APIs, with paths under `effect/unstable/*` explicitly allowed to evolve. See [Effect 4.0 release and current API notes](https://effect.website/blog/effect-v4-rc-september-recap) and [v4 docs](https://effect.website/docs/).

## Steps
1. **Pilot one isolated workflow (S, 3–5 days):** model outbox relay lifecycle with Effect for scoped resources, cancellation, retry and typed failures; keep SQL transaction semantics and durable dedupe in existing adapters. Compare against current worker for clarity and behavior.
2. **Decide adoption boundary (S, 2 days):** document runtime ownership, error mapping, testing and deployment cost before expanding.
3. **Optional ports pilot (M, 1 week):** if the relay pilot succeeds, convert one high-async `packages/app` port/use-case seam or the payout provider integration, with adapter interoperability and conformance coverage.
4. **Expand only by evidence (M, per workflow):** consider streams or structured concurrency where they materially simplify resource lifecycle; avoid unstable APIs in production paths unless explicitly accepted.

Keep pure domain decisions, money arithmetic, validation, synchronous transformations, simple CRUD ports and deterministic helpers as plain TypeScript. Start with the outbox relay rather than converting every port: it has clear resource lifetime, cancellation and retry concerns. Payout provider is a later candidate because timeout/retry/outcome-unknown handling is critical and must preserve idempotency and audit behavior.

## Risks
Learning and runtime overhead; dual Effect/Promise conventions; accidental loss of transaction boundaries or at-least-once dedupe; unstable module API churn; opaque failure mapping. Effect does not make external side effects durable by itself.

## Owner decisions (recommended defaults)
- Adopt Effect v4? **Approve a bounded relay pilot only; no repository-wide conversion.**
- Which pilot? **Outbox relay first**, payout provider only after an explicit evaluation.
- API boundary? **Keep ports and domain APIs Promise-based initially; isolate Effect in worker composition/adapters.**
- Unstable modules? **Avoid in production until a specific need and upgrade owner are documented.**

## Linear packages to create
EFF-1 outbox relay Effect pilot (S); EFF-2 pilot review and runtime/observability decision (S; depends EFF-1); EFF-3 optional payout-provider/port integration (M; owner gate after EFF-2); EFF-4 adoption guide and boundaries (S; after EFF-2).
