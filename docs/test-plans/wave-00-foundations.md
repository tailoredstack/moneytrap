# Test Plan — Wave 0: Foundations and spikes

**Scope:** WP-0.1 to WP-0.10 · **Milestone:** M0 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W0-###`

## 1. Objective

Prove that the repo builds, lints, enforces boundaries, and produces a binary on macOS and Linux, and that the three spikes give a pass or a recorded fallback.

## 2. Entry criteria

- Bun and Docker installed on CI runners.
- Product owner available for WP-0.10 (latency and availability targets).

## 3. Test matrix

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W0-001 | Tooling | `bun install` on clean checkout | Exit 0, lockfile unchanged | WP-0.1 |
| TP-W0-002 | Tooling | `bun run typecheck` on empty packages | Exit 0 | WP-0.1 |
| TP-W0-003 | Lint | Biome check on the repo | Exit 0 | WP-0.2 |
| TP-W0-004 | Boundary | Seeded file in `domain` imports `adapter-postgres` | `dependency-cruiser` fails with rule name | WP-0.2 |
| TP-W0-005 | Boundary | Seeded `app` import of `apps/server` | Fails | WP-0.2 |
| TP-W0-006 | Boundary | Seeded `web` import of `server` | Fails | WP-0.2 |
| TP-W0-007 | CI | Push to branch | Pipeline runs typecheck, lint, boundaries, test, build on macOS and Linux | WP-0.3 |
| TP-W0-008 | CI | Seeded failing test | Pipeline red, merge blocked | WP-0.3 |
| TP-W0-009 | Infra | `docker compose up` | Postgres 16 and Redis 7 healthy within 60 s | WP-0.4 |
| TP-W0-010 | Infra | `psql` and `redis-cli PING` against compose | Connect and respond | WP-0.4 |
| TP-W0-011 | Spike A | Compile binary on clean macOS and Linux VM | Single executable, runs without Bun installed | WP-0.5 |
| TP-W0-012 | Spike A | Binary serves Elysia route and embedded page | `GET /health` 200; `GET /` returns HTML with embedded asset hash | WP-0.5 |
| TP-W0-013 | Spike A | `--migrate` on empty database, then again | First run creates tables; second is a no-op | WP-0.5 |
| TP-W0-014 | Spike B | Redirect load on built binary, cache hit | p95 and p99 meet WP-0.10 targets | WP-0.6 |
| TP-W0-015 | Spike B | Revoke link, then redirect | Denied within 5 s | WP-0.6, CT-014 |
| TP-W0-016 | Spike B | Stop Redis and Postgres, redirect | 503, no `Location` header | WP-0.6 |
| TP-W0-017 | Spike B | Click enqueue during redirect | Response does not wait on queue write (p95 unchanged with queue delayed 500 ms) | WP-0.6 |
| TP-W0-018 | Spike C | Each library under `bun test` | Pass | WP-0.7 |
| TP-W0-019 | Spike C | Same library checks in compiled binary | Pass or ADR fallback recorded | WP-0.7 |
| TP-W0-020 | ADR | ADR-001 to ADR-011 files | Each has status Accepted or Rejected with date | WP-0.8 |
| TP-W0-021 | Conformance | Run conformance package | 22 `todo` entries, each tagged with a milestone | WP-0.9 |
| TP-W0-022 | Conformance | Tag check | Every CT ID appears exactly once | WP-0.9 |

## 4. Exit criteria

- TP-W0-001 to 010, 020, 021, 022 green on CI.
- Spike results recorded for TP-W0-011 to 019 (pass or fallback ADR).
- WP-0.10 targets signed off in `ops/load/profile.md`.

## 5. Test data and environment

- Seeded-violation fixtures live in `ops/boundary-fixtures/` and are excluded from the build.
- Load tests run on a dedicated runner, not shared CI.

## 6. Risks

- Spike results depend on the runner. Record hardware in the spike report.
- Binary smoke test on a clean VM may be slow; run nightly if PR time is tight.
