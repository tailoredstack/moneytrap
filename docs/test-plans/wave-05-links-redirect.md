# Test Plan — Wave 5: Links, redirect, click trace

**Scope:** WP-5.1 to WP-5.12 · **Milestone:** M4 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W5-###`
**Conformance focus:** CT-006 (link path), CT-010, CT-011, CT-013, CT-014

## 1. Objective

Approved publishers create links. Visitors are redirected safely and quickly. Revocation takes effect within the guarantee. Each real click is recorded once. The redirect never waits on storage, and fails closed.

## 2. Entry criteria

- Wave 4 gate passed (eligibility decisions persisted).
- Redis and Postgres in compose; redirect spike (WP-0.6) results recorded.
- Load profile (WP-0.10) confirmed.

## 3. Test matrix

### 3.1 Link domain and actions

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W5-001 | Transition `draft` → `active` | Allowed | WP-5.1 |
| TP-W5-002 | Transition `revoked` → `active` | Rejected | WP-5.1 |
| TP-W5-003 | Destination `javascript:` scheme | Rejected at creation | WP-5.1, §4.4 |
| TP-W5-004 | Destination host not on allow-list | Rejected at creation | WP-5.1 |
| TP-W5-005 | Create link for approved property with eligible program | Link `active`; route view invalidated | WP-5.2 |
| TP-W5-006 | Create link for eligible program but property suspended | Rejected; precondition reason | WP-5.2, CT-006 |
| TP-W5-007 | Create link for ineligible program | Rejected with reason `geography` (or as decided) | WP-5.2, CT-010 |
| TP-W5-008 | Preview link (no write) | Returns preview; no row; no outbox event | WP-5.2 |
| TP-W5-009 | Edit link destination | Re-validated; version bumped | WP-5.2 |
| TP-W5-010 | Pause then resume | State changes; version bumped each time | WP-5.2 |
| TP-W5-011 | Revoke link | `revoked`; irreversible | WP-5.2 |
| TP-W5-012 | Create link with same idempotency key twice | One link | WP-5.2, WP-1.10 |

### 3.2 Bulk CSV

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W5-013 | CSV with 1,000 valid rows | All created; job `completed`; per-row results | WP-5.3 |
| TP-W5-014 | CSV with 5 invalid rows among 1,000 | 995 created; 5 row errors with row numbers | WP-5.3 |
| TP-W5-015 | Process crashes mid-job, resumed | No duplicate links; job completes | WP-5.3 |
| TP-W5-016 | CSV with formula injection (`=HYPERLINK`) in label | Stored as text; export neutralizes | WP-5.3, §4.4 |
| TP-W5-017 | Submit same CSV twice with same submission ID | Second returns the first job | WP-5.3 |
| TP-W5-018 | CSV over the size limit | Rejected before parsing | WP-5.3 |

### 3.3 Redirect safety and latency

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W5-019 | Active link, cache hit | 302 to destination; no DB query (spy) | WP-5.6 |
| TP-W5-020 | Active link, cache miss | DB read; cache populated; 302 | WP-5.4 |
| TP-W5-021 | Unknown token | 410 or 404 per UI-036 mapping (410 for unknown) | WP-5.6, UI-036 |
| TP-W5-022 | Revoked link | 410; no destination leak | WP-5.6 |
| TP-W5-023 | Revoke then redirect within window | Denied; revocation latency ≤ 5 s measured | WP-5.5, CT-014 |
| TP-W5-024 | Stale cached allow after revoke (Redis version key updated) | Version mismatch forces DB read; deny wins | WP-5.5, CT-014 |
| TP-W5-025 | Destination host changed to unsafe after creation | Blocked at redirect time | WP-5.7, CT-011 |
| TP-W5-026 | Destination is a redirect chain to an unapproved host | Not followed; blocked | WP-5.7, CT-011 |
| TP-W5-027 | Redis and Postgres both down | 503; no `Location` | WP-5.6 |
| TP-W5-028 | Redis down, Postgres up | Falls back to DB; correct result; latency degraded but within error budget | WP-5.4 |
| TP-W5-029 | Queue down, redirect request | 302 still returned; click buffered or dropped with metric | WP-5.6 |
| TP-W5-030 | Redirect load test at target profile | p95 ≤ 50 ms and p99 ≤ 150 ms on cache hit | WP-X.2 |
| TP-W5-031 | Token guessing: 10,000 random tokens | No enumeration signal beyond 410; rate limit applied | WP-5.6, §7 |

### 3.4 Click ingestion and analytics

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W5-032 | One click | One row | WP-5.8 |
| TP-W5-033 | Same click emitted twice (same dedup key) | One row | WP-5.8, CT-013 |
| TP-W5-034 | Two distinct legitimate clicks, same visitor, 1 s apart | Two rows | WP-5.8, CT-013 |
| TP-W5-035 | Consumer replays event after crash | No duplicate; inbox dedupes | WP-5.8, WP-1.7 |
| TP-W5-036 | Click analytics for period | Cursor-paginated; `as_of` present | WP-5.9 |
| TP-W5-037 | Click analytics with lagging ingestion | `data_stale` badge in response | WP-5.9 |
| TP-W5-038 | Duplicate-click heuristic fires | Risk flag created; click still counted | WP-5.10 |

### 3.5 UI and E2E

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W5-039 | Create link form, invalid destination | Field error; value kept | WP-5.11 |
| TP-W5-040 | Preview then create | Preview shows exact destination string | WP-5.11 |
| TP-W5-041 | CSV upload with 5 bad rows | Per-row table; retry only failed rows | WP-5.11 |
| TP-W5-042 | Copy link button | Copies; confirmation announced | WP-5.11 |
| TP-W5-043 | Analytics chart and table | Table matches chart; keyboard navigable; not colour-only | WP-5.11 |
| TP-W5-044 | E2E pilot flow: approved publisher creates link, visitor redirected, click shown | Passes on built binary | WP-5.12 |

### 3.6 Conformance

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W5-045 | CT-006 (link), CT-010, CT-011, CT-013, CT-014 | Green in-process and on built binary | WP-5.12 |

## 4. Exit criteria

- All TP-W5 green; conformance set green on built binary.
- Redirect SLO met under load (TP-W5-030) and revocation guarantee met (TP-W5-023).
- Pilot gate (Project plan M4): 10 pilot publishers, measured at week 4 (outside test scope, tracked in product analytics).

## 5. Test data

- Links: active, paused, revoked, expired, unsafe-destination fixtures.
- Load: 10,000 active links, 80/20 hot/cold token distribution.
- Click fixtures: duplicate and distinct sequences with fixed timestamps.

## 6. Risks

- Cache coherence bugs are the most likely source of CT-014 failure. Add a randomized test that interleaves revokes and redirects (model-based test) before the wave gate.
- Load tests depend on the runner; record hardware.
