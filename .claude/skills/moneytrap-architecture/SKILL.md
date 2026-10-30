---
name: moneytrap-architecture
description: Use when adding or changing server code in Moneytrap: actions, queries, guards, ports, the Ctx object, transactions, the outbox, or module boundaries. Read before creating a new feature folder.
---

# Moneytrap architecture

## Layers

- `packages/domain`: pure rules (state machines, money, eligibility, allocation). No I/O.
- `packages/app`: actions (writes) and queries (reads), one file each. External ports only.
- `packages/schema`: Kysely types only.
- `apps/server`: HTTP routes, authentication, guards, composition root.

## Rules

- **Actions only mutate.** One transaction. State change, outbox row, and audit row together. Return the new state.
- **Queries only read.** Return DTOs. No writes, no audit rows.
- **No authentication or authorization in actions or queries.** The route guard decides before the call.
- **`Ctx`** carries `db`, `clock`, `ids`, `notifier`, and `actor` (for audit only).
- **Business preconditions stay in actions** (for example, "property must be approved"). These are domain rules, not permissions.
- **Ports only at real seams**: clock, ids, notifier, network connector, payout provider, secret box, route cache, DNS resolver.
- **No repositories.** Kysely queries live in the action or query file, or in a `_queries.ts` next to it.
- **Money** is `bigint` minor units. Never floats.
- **External calls** go through the outbox, never inline inside a money transaction.

## Adding a feature

1. Add the test plan entry first (wave doc in `docs/test-plans/`).
2. Write the domain test, then the action or query test against Postgres.
3. Add the route with its guard declaration. A route without a guard fails the build.
4. Add the outbox event if other parts of the system need to react.
5. Update the work package status in `docs/implementation/IMPLEMENTATION_PLAN.md`.

## Boundary check

Run the dependency-cruiser rules. A violation (for example, `app` importing `apps/server`) fails CI.
