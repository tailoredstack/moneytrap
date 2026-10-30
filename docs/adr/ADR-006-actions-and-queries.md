# ADR-006: Actions and queries over Kysely, with a pure domain and no repositories

- Status: Accepted, 2026-10-31
- Date: 2026-10-31
- Spike: none. Structure is enforced by the boundary rules from WP-0.3.

## Context

Blueprint §3 simplifies hexagonal architecture for a small team. The team wants explicit transactions and no ORM magic on money paths, but without a repository layer that hides SQL or a DI container that hides wiring.

## Decision

- Writes are **actions** and reads are **queries**. Each is one file in `packages/app`.
- `domain` is pure TypeScript with no I/O and no framework imports.
- Actions and queries use Kysely directly. There are no repositories.
- Ports exist only at external seams: clock, notifier, network connectors, payout providers.
- `apps/server` is the composition root. It wires adapters into actions and queries by plain function calls. There is no DI container.

## Evidence

WP-0.3 added `dependency-cruiser` rules and tests that probe each rule (`scripts/boundaries.test.ts`). They block `domain` from importing the workspace, Node core modules, Elysia, or `pg`, and block `app` from importing Redis or Elysia.

## Consequences

- SQL lives in actions and queries. Shared fragments go in query helpers, not in repositories.
- Tests use fakes at the ports listed above, not at the database. Integration tests use the real Postgres schema (Blueprint §6).

## Fallback

If the number of actions makes the composition root hard to read, split it into per-feature factory functions. Those functions still take their dependencies as arguments, so the no-container rule holds. Introducing a container requires a new ADR.
