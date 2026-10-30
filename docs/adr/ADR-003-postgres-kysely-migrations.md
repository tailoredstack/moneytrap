# ADR-003: Postgres with Kysely, and statically bundled migrations

- Status: Accepted, 2026-10-31
- Date: 2026-10-31
- Spike: WP-0.5 (binary shape), WP-0.7 (library compatibility)

## Context

Moneytrap needs transactions, constraints, `bigint` and `numeric` columns, and row locks for reservations (Blueprint §1). The binary must carry its migrations with it, and migrations run only on `--migrate`.

## Decision

Use PostgreSQL with Kysely `0.29.7` and `pg` `8.16.3` through `PostgresDialect`. Import the migrator and migration types from `kysely/migration`. The root export is deprecated in 0.29. Each migration is a TypeScript module imported statically into a `MigrationProvider`, so the compiled binary carries the set and reads no files at runtime. Kysely `DB` types live in `packages/schema`, which has no runtime code.

## Evidence

- WP-0.7: Kysely insert and read passed under `bun test` and in the compiled binary. The migration set in `spikes/compat/src/migrations.ts` is statically imported, and `--migrate` ran it in the binary.
- WP-0.5: a Kysely migration ran in the compiled binary with `--migrate` against Postgres.

## Consequences and required follow-up

- WP-0.5's spike pins `kysely@0.28.8`. Better Auth 1.7.14 requires `^0.28.17 || ^0.29`, so `0.28.8` cannot be combined with Better Auth. Bump Kysely to the 0.29 line in the first work package that uses both. The bump is recorded here and is not part of WP-0.8, which changes docs only.
- New migrations import from `kysely/migration`. Do not import the deprecated root export.

## Fallback

If Kysely 0.29 blocks a required feature, pin `kysely@0.28.17`, which Better Auth also accepts, and keep migrations statically bundled. A different query layer needs its own ADR.
