# Test Plan — Wave 7: Settlement and payouts

**Scope:** WP-7.1 to WP-7.13 · **Milestone:** M6 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W7-###`
**Conformance focus:** CT-019, CT-021, CT-022, plus chaos scenarios

## 1. Objective

Money moves safely. Only matched and cleared funds become available. Concurrent requests cannot over-reserve. A timeout is an `unknown` outcome, never a failure that gets retried blindly. Payouts never pay twice.

## 2. Entry criteria

- Wave 6 gate passed; ledger invariants document signed.
- Payout provider simulator (WP-7.4) built with fault injection.
- Maker-checker roles defined in the guard table.
- Finance review of the unknown-outcome rule scheduled.

## 3. Test matrix

### 3.1 Settlement

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-001 | Import receipt with source identity | Stored; duplicate receipt ignored | WP-7.1 |
| TP-W7-002 | Manual upload of receipt file | Parsed; rows validated; errors reported | WP-7.1 |
| TP-W7-003 | Receipt covers 3 of 5 conversions | Only 3 cleared; 2 remain pending | WP-7.2, CT-021 |
| TP-W7-004 | Receipt partially matches one conversion | Matched portion clears; remainder exception | WP-7.2, CT-021 |
| TP-W7-005 | Funding state `approved` without receipt | Not cleared | WP-7.3 |
| TP-W7-006 | Funding transitions | `expected` → `reported settled` → `receipt matched` → `cleared`; illegal jumps rejected | WP-7.3 |

### 3.2 Payout methods and policy

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-007 | Enroll method via provider-hosted flow (simulator) | Method `active` with provider reference only | WP-7.5 |
| TP-W7-008 | Raw account number submitted to our API | Rejected by schema; never stored | WP-7.5, §4.4 |
| TP-W7-009 | Minimum payout threshold | Below threshold: no batch includes publisher | WP-7.6 |
| TP-W7-010 | Hold active | Publisher excluded from batch; reason shown | WP-7.6 |
| TP-W7-011 | Policy version changed | Historical batches unaffected | WP-7.6 |

### 3.3 Reservation and batch (concurrency)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-012 | Two concurrent batch preparations for same funds | Exactly one reservation per amount; other fails or reserves less | WP-7.7, CT-022 |
| TP-W7-013 | Reservation key reused | Idempotent; same reservation returned | WP-7.7 |
| TP-W7-014 | Prepare batch, then reverse funds before approval | Postgres preparation reads available in the same transaction as the publisher lock and reservation; approval reads available in the same transaction as its lock and approval decision. Deterministically reverse funds between prepare and approve and prove neither step uses a stale pre-lock snapshot and the batch cannot exceed available | WP-7.7, WP-7.8, OZE-3279, OZE-3285 |
| TP-W7-015 | Property test: interleavings of prepare, cancel, approve, reversal, and dispatch | Interleave all five operations and assert reservations, approvals, and dispatch never act on stale available; reserved never exceeds available; no negative balance occurs without a deficit record | WP-7.7, WP-7.8, WP-7.9, OZE-3279, OZE-3285 |
| TP-W7-036 | Batch prepared with a release cap | Total reserved never exceeds the cap; publishers beyond it are listed as `over_cap`; a reservation cut below the policy minimum is skipped | WP-7.7 |
| TP-W7-037 | Cancel a prepared batch | Its reservations are freed for a later batch; a second cancel changes nothing; another organization's batch is not found | WP-7.7 |
| TP-W7-038 | Prepare finds nothing to reserve | No batch is written and the reservation key stays free | WP-7.7 |
| TP-W7-039 | Settlement import API authorization and stored upload resolution | `POST /v1/admin/settlements/import` rejects unauthorized actors; accepted uploads are persisted and their `object_ref` resolves to the stored file; parse/validation errors identify source line numbers | WP-7.1, OZE-3267 |
| TP-W7-040 | Settlement import UI-045 states | Import UI covers receipt selector, file selection, preview, progress, exceptions, loading, error, and success states; exceptions and errors remain associated with the relevant imported lines | WP-7.1, OZE-3267, UI-045 |
| TP-W7-041 | Settlement allocations and reconciliation exceptions persistence | Persist allocations and exceptions; candidate source is an approved conversion's net amount after prior allocations; transactional locks enforce gross and outstanding bounds and unique receipt/conversion allocation | WP-7.2, OZE-3268 |
| TP-W7-042 | Provider reference verification before payout method activation | Verify the provider reference before activating a method; a rejected reference leaves no payout method row | WP-7.5, OZE-3269 |
| TP-W7-043 | Payout method screens and hosted enrollment states | UI-047/048 cover pending, verified, and disabled methods; hosted enrollment success/error, loading/error/success states, and authorization/suspension guards | WP-7.5, OZE-3270, UI-047, UI-048 |
| TP-W7-044 | Versioned default hold period and approval history | Hold-period changes create versions and retain owner, approval decision, and change history; keep the package on HOLD until finance confirms the values and rules | WP-7.6, OZE-3271 |
| TP-W7-045 | Finance policy write permissions and trusted timestamps | Action-level finance permissions guard policy publish and hold writes; trusted server timestamps prevent clients from backdating policy or hold changes | WP-7.6, OZE-3272 |
| TP-W7-046 | Placement/release/window contract suite across stores | Run the same contract scenarios for placement, release, window, tenant, version, and effective-date behavior against both the fake store and Postgres; both implementations satisfy identical expectations | WP-7.13, OZE-3277 |
| TP-W7-047 | Prepare/cancel HTTP route authorization and idempotency | Prepare and cancel routes enforce `payouts:write` organization scope and request schemas, use production composition, and preserve documented idempotency behavior across retries | WP-7.7, OZE-3280 |

### 3.4 Maker-checker

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-016 | Preparer tries to approve own batch | Guard returns `FORBIDDEN` | WP-7.8 |
| TP-W7-017 | Different finance user approves | Approved; audit row contains both actors | WP-7.8 |
| TP-W7-018 | Approval after batch cancelled | Rejected | WP-7.8 |
| TP-W7-048 | Approve the same batch twice, including two approvals at once | One approval and one audit row; the rest return `ALREADY_PROCESSED` | WP-7.8 |
| TP-W7-049 | Refused self-approval is written to the audit log | The `payout_batch.approval_denied` row names the preparer and the attempting user, with reason `self_approval`; the batch is unchanged (behaviour in TP-W7-016) | WP-7.8 |
| TP-W7-050 | Cancel an approved batch, or approve and cancel at once | The approved batch is not cancelled (`STATE_CONFLICT`); exactly one of a racing pair takes effect | WP-7.8 |
| TP-W7-051 | Direct SQL approves as the preparer, approves twice, or edits an approved batch | The database refuses | WP-7.8 |

### 3.5 Dispatch and unknown outcomes (chaos)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-019 | Provider accepts transfer | State `dispatched` then `processing` then `paid` | WP-7.9 |
| TP-W7-020 | Provider timeout on dispatch | State `unknown`; no retry dispatch sent | WP-7.9, §6.2 |
| TP-W7-021 | Query after `unknown` shows transfer exists | Moves to `paid`; no second transfer | WP-7.9, CT-019 |
| TP-W7-022 | Query after `unknown` shows no transfer | Moves to `failed`; funds returned to available; retry allowed with same request ID policy | WP-7.9 |
| TP-W7-023 | Query itself times out | Stays `unknown`; reconciliation job retries query later | WP-7.9 |
| TP-W7-024 | Duplicate provider callback | One state change | WP-7.9 |
| TP-W7-025 | Out-of-order callbacks (`paid` before `processing`) | Final state `paid`; no regression | WP-7.9 |
| TP-W7-026 | `unknown` payout auto-retry attempted by worker | Blocked by state rule | WP-7.9 |
| TP-W7-027 | Paid payout reversed by settlement | Recoverable deficit recorded; no extra payment | WP-7.9, CT-019 |
| TP-W7-028 | Provider down for 1 hour during batch | Batch stays `approved`; no partial dispatch without record | WP-7.9 |

### 3.6 Publisher and ops UI

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-029 | Payout history shows `unknown` with explanation | Explanation text; no internal ID shown to publisher | WP-7.10 |
| TP-W7-030 | Batch approval screen, approve clicked twice | One approval; button disabled after submit | WP-7.11 |
| TP-W7-031 | Batch detail for large batch (5,000 lines) | Paginated; totals shown with currency and `as_of` | WP-7.11 |
| TP-W7-032 | Method enrollment redirect returns with error | Error explained; no secret echoed | WP-7.10 |

### 3.7 Runbook

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-033 | Dry run: operator resolves seeded `unknown` payout from runbook only | Resolved correctly within 15 min | WP-7.12 |

### 3.8 Conformance and chaos suite

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W7-034 | CT-019, CT-021, CT-022 | Green | WP-7.13 |
| TP-W7-035 | Chaos suite: timeouts, duplicates, out-of-order, provider outage, process kill mid-dispatch | No duplicate transfer across 500 seeded runs | WP-7.13 |

## 4. Exit criteria

- All TP-W7 green including the 500-run chaos suite.
- Zero duplicate transfers in chaos runs.
- Payout runbook dry run passed (TP-W7-033).
- Finance and engineering sign-off on the unknown-outcome rule.
- Limited release cap per batch configured and tested (TP-W7-031 covers display; cap test added in WP-7.7).

## 5. Test data

- Provider simulator scenarios: `happy`, `timeout-then-exists`, `timeout-then-absent`, `duplicate-callback`, `out-of-order`, `outage`.
- Publishers with: zero balance, exact threshold, hold, reversed-after-paid.

## 6. Risks

- Provider semantics differ from simulator. Each simulator scenario maps to a documented provider behavior; unmapped behavior blocks launch.
- Clock skew between provider and us affects status windows. Use provider timestamps for ordering, not local receipt time.
