# Test Plan — Wave 3: Publisher and property approval

**Scope:** WP-3.1 to WP-3.11 · **Milestone:** M2 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W3-###`
**Conformance focus:** CT-006, CT-007

## 1. Objective

A publisher submits KYB and a website property, proves ownership, and is approved by review. Verified is never treated as approved. Suspension stops new monetization immediately and keeps history readable for staff.

## 2. Entry criteria

- Wave 2 gate passed; guards in place for publisher and property routes.
- DNS resolver fake available.

## 3. Test matrix

### 3.1 Publisher lifecycle

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W3-001 | Transition `draft` → `submitted` | Allowed | WP-3.1 |
| TP-W3-002 | Transition `draft` → `approved` | Rejected | WP-3.1 |
| TP-W3-003 | Submit KYB with document reference | Stored as reference; no bytes in table | WP-3.2 |
| TP-W3-004 | KYB payload logged | No document contents in logs (redaction test) | WP-3.2, §4.4 |
| TP-W3-005 | Reviewer decision without reason | Rejected with `VALIDATION_FAILED` | WP-3.3 |
| TP-W3-006 | Reviewer approves | Publisher `approved`; audit row in same transaction (failing audit insert rolls back decision) | WP-3.3 |
| TP-W3-007 | Reviewer decision by a principal without review permission | Guard returns `FORBIDDEN`; action not called | WP-3.3 |

### 3.2 Property lifecycle and verification

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W3-008 | Create website property | `draft` | WP-3.4 |
| TP-W3-009 | Request DNS challenge | Challenge token generated; expiry set | WP-3.5 |
| TP-W3-010 | Verify with matching TXT record (fake resolver) | `verified` | WP-3.5 |
| TP-W3-011 | Verify with missing record | Stays `verification pending`; retry allowed | WP-3.5 |
| TP-W3-012 | Verify with expired challenge | Rejected; new challenge needed | WP-3.5 |
| TP-W3-013 | Verify twice concurrently | One state change; no duplicate events | WP-3.5 |
| TP-W3-014 | Submit verified property for review | `review pending` | WP-3.6 |
| TP-W3-015 | Verified but not approved: create a link (wave 5 action stub) | Denied; reason `not approved` | WP-3.6, CT-006 |
| TP-W3-016 | Reviewer approves property | `approved`; monetizable flag true | WP-3.6 |
| TP-W3-017 | Reviewer rejects property | `rejected`; reason recorded; no monetizable flag | WP-3.6 |

### 3.3 Suspension and history

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W3-018 | Suspend approved property | `suspended`; monetizable flag false within the same transaction | WP-3.7 |
| TP-W3-019 | Suspended property, link creation attempt | Denied immediately | WP-3.7, CT-007 |
| TP-W3-020 | Staff reads history of suspended property | Available, with status and decision trail | WP-3.7, CT-007 |
| TP-W3-021 | Publisher reads history of suspended property | Shows suspended status; no internal reviewer notes | WP-3.7 |
| TP-W3-022 | Reinstate with reason | `approved` again; audit row | WP-3.7 |

### 3.4 Ops console and audit (UI and E2E)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W3-023 | Review queue loads with 50 items | Paginated; stable order; count shown | WP-3.8 |
| TP-W3-024 | Decision form submit with empty reason | Field error announced; focus moves to error | WP-3.8 |
| TP-W3-025 | Evidence panel shows only allowed documents | Non-permitted document hidden; server rejects direct fetch | WP-3.8 |
| TP-W3-026 | Audit viewer for a decision | Shows actor, scope, reason, timestamp, object | WP-3.9 |
| TP-W3-027 | Publisher onboarding status screen, each state | Renders: draft, submitted, in review, approved, rejected | WP-3.10 |
| TP-W3-028 | Property inventory with suspended item | Status badge text plus icon; not colour only | WP-3.10 |
| TP-W3-029 | Verification instructions copy button | Copies challenge; confirmation announced | WP-3.10 |
| TP-W3-030 | Stale status after decision in another tab | Page shows refresh prompt; no silent overwrite | WP-3.10 |

### 3.5 Conformance

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W3-031 | CT-006 and CT-007 in `conf` | Green | WP-3.11 |

## 4. Exit criteria

- All TP-W3 green; CT-006 and CT-007 green.
- Dogfood: ten synthetic publishers reviewed end-to-end with recorded decisions (Project plan M2 gate).
- Accessibility check (WP-X.5) passed for ops and publisher property screens.

## 5. Test data

- Fixture publishers: draft, submitted, approved, rejected, suspended.
- Fake DNS resolver with programmable TXT records.

## 6. Risks

- Verification races with DNS caching. Tests use the fake resolver; a manual check against a real domain is part of dogfood.
