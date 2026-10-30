# Test Plan — Wave 1: Platform kernel

**Scope:** WP-1.1 to WP-1.15 · **Milestone:** M0→M1 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W1-###`

## 1. Objective

The shared kernel is correct before any feature uses it: money arithmetic, IDs, error mapping, migrations, transactions, outbox delivery, idempotency, HTTP kernel, contracts, and single-binary packaging.

## 2. Entry criteria

- Wave 0 gate passed (CI green, ADR-001 to ADR-011 decided).
- Local Postgres and Redis available via `ops/docker-compose.yml`.

## 3. Test matrix

### 3.1 Money and IDs (domain, unit and property)

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-001 | Unit | Create `Money` from minor units `12537n` USD | Formats as `"125.37"` | WP-1.1 |
| TP-W1-002 | Unit | Parse `"125.37"` and `"125.3"` for USD | First ok; second rejected with `VALIDATION_FAILED` | WP-1.1 |
| TP-W1-003 | Unit | Parse `"12.5"` for JPY (exponent 0) | Rejected | WP-1.1 |
| TP-W1-004 | Unit | Add USD + EUR | Throws `VALIDATION_FAILED` | WP-1.1 |
| TP-W1-005 | Unit | Input as JS `number` | Rejected at parser; no float path exists | WP-1.1 |
| TP-W1-006 | Property | Random sums and differences of same-currency values | Result equals integer sum; no overflow past `bigint` range is silent | WP-1.1 |
| TP-W1-007 | Unit | Generate ID with type `lnk` | Starts with `lnk_`; type mismatch rejected when parsing | WP-1.2 |
| TP-W1-008 | Lint | Search `domain` and `app` for `Date.now` and `Math.random` | Zero matches | WP-1.2 |

### 3.2 Errors

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-009 | Unit | Every code in spec §7.1 | Has one HTTP status mapping and a stable string | WP-1.3 |
| TP-W1-010 | Unit | Unknown code string | Maps to `500` with generic body; no stack trace | WP-1.3 |

### 3.3 Persistence and migrations

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-011 | Integration | `--migrate` on empty database | Applies `0001` in order | WP-1.4 |
| TP-W1-012 | Integration | `--migrate` run twice | Second run no-op | WP-1.4 |
| TP-W1-013 | Integration | Migration fails midway (seeded bad SQL) | Transaction rolled back; next run retries | WP-1.4 |
| TP-W1-014 | Integration | Audit role `UPDATE audit_logs` | Permission denied | WP-1.5 |
| TP-W1-015 | Integration | Audit role `DELETE audit_logs` | Permission denied | WP-1.5 |
| TP-W1-016 | Integration | `withTx` throws after write | Row absent after call | WP-1.6 |
| TP-W1-017 | Integration | `withTx` nested call | Rejected with clear error | WP-1.6 |

### 3.4 Outbox and queue

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-018 | Integration | Action writes state and outbox row, then throws | Neither persisted | WP-1.7 |
| TP-W1-019 | Integration | Relay publishes two events in order | Both delivered in insertion order | WP-1.7 |
| TP-W1-020 | Integration | Relay crashes after publish before mark | Event delivered again; consumer ignores via inbox | WP-1.7 |
| TP-W1-021 | Integration | Two relay instances | No event published twice concurrently (`SKIP LOCKED`) | WP-1.7 |

### 3.5 HTTP kernel, idempotency, contracts

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-022 | HTTP | `app.handle()` on a test route | Response has `x-request-id` | WP-1.8 |
| TP-W1-023 | HTTP | Error from action mapped | Body uses envelope from `contracts`; code is stable | WP-1.8, WP-1.9 |
| TP-W1-024 | HTTP | Mutating route with same key and same body twice | Second returns stored response; one row | WP-1.10 |
| TP-W1-025 | HTTP | Same key, different body | `STATE_CONFLICT` | WP-1.10 |
| TP-W1-026 | HTTP | Same key, first request still in progress | Second returns `PROCESSING` or waits; never duplicates effect | WP-1.10 |
| TP-W1-027 | Unit | Money schema encode and decode | Decimal string round-trips exactly | WP-1.9 |
| TP-W1-028 | Unit | Pagination schema with page size above limit | Rejected | WP-1.9 |
| TP-W1-029 | HTTP | `/healthz` and `/readyz` with Postgres down | `/healthz` 200; `/readyz` 503 | WP-1.11 |
| TP-W1-030 | Unit | Logger receives a token-shaped field | Output shows `[REDACTED]` | WP-1.11 |

### 3.6 Test kit and adapter contracts

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-031 | Unit | Fake clock advance by 1 h | `now()` returns advanced value; no real sleep | WP-1.12 |
| TP-W1-032 | Lint | Every port in `app/src/ports/` has a fake in `test-kit` | Check script passes | WP-1.12 |
| TP-W1-033 | Contract | Shared contract suite on fake and Postgres for a sample aggregate | Same results | WP-1.13 |

### 3.7 Web shell and packaging

| ID | Layer | Scenario | Expected | Refs |
|---|---|---|---|---|
| TP-W1-034 | Component | Shell renders skip link and landmark regions | Present; reachable by keyboard | WP-1.14 |
| TP-W1-035 | Component | API client call returns envelope error | Error boundary shows generic state | WP-1.14 |
| TP-W1-036 | E2E | Built binary serves shell at `/` | 200 with asset hash match | WP-1.15 |
| TP-W1-037 | E2E | Built binary `--migrate` then serve | Health green | WP-1.15 |

## 4. Exit criteria

- All TP-W1 tests green on CI for macOS and Linux.
- Property test seeds recorded; any failing seed becomes a permanent regression test.
- Coverage: `domain` ≥ 95% lines; `app` kernel modules ≥ 90%.

## 5. Test data

- Money fixtures: boundary values (0, 1 minor unit, max `bigint` range for currency).
- Postgres: one schema per worker, created from migrations.

## 6. Risks

- Relay tests are timing sensitive. Use the fake clock and explicit `step()` on the relay, not sleeps.
