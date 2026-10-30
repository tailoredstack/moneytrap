# Test Plan — Wave 8: Developer platform

**Scope:** WP-8.1 to WP-8.10 · **Milestone:** M7 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W8-###`

## 1. Objective

Partners integrate through scoped keys, signed webhooks, paginated reports, and exports. Key principals go through the same guard table as sessions. The public contract cannot change without a visible diff.

## 2. Entry criteria

- Wave 6 gate passed (reports and balances available).
- Guard table in place (WP-2.11) and extended for key principals.
- Cursor pagination and OpenAPI skeleton merged early (see WAVES early starts).

## 3. Test matrix

### 3.1 API keys

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W8-001 | Create key | Secret shown once; stored as hash only | WP-8.1 |
| TP-W8-002 | Read key list | Secret never returned after creation | WP-8.1 |
| TP-W8-003 | Rotate key | New key active; old key valid through grace period, then rejected | WP-8.1 |
| TP-W8-004 | Revoke key | Next request → `UNAUTHENTICATED` immediately | WP-8.1 |
| TP-W8-005 | Key with `reports:read` calls write route | `FORBIDDEN`; action not called | WP-8.2 |
| TP-W8-006 | Key from org A reads org B resource | `RESOURCE_NOT_FOUND` | WP-8.2, CT-005 |
| TP-W8-007 | Key principal in logs | Only key ID prefix appears | WP-8.2, §4.4 |
| TP-W8-008 | Rate limit exceeded | `RATE_LIMITED` with reset header | WP-8.2 |

### 3.2 Webhooks

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W8-009 | Create endpoint with HTTPS URL | Accepted; signing secret shown once | WP-8.3 |
| TP-W8-010 | Endpoint pointing at private IP range | Rejected (SSRF guard) | WP-8.3 |
| TP-W8-011 | Endpoint with `http://` URL | Rejected in production config | WP-8.3 |
| TP-W8-012 | Delivered payload signature | Verifies with the secret; tampered body fails | WP-8.3 |
| TP-W8-013 | Rotate signing secret | Both secrets valid for grace period | WP-8.3 |
| TP-W8-014 | Test delivery | Delivered; log entry created | WP-8.4 |
| TP-W8-015 | Endpoint returns 500 | Retries with backoff up to bound; then dead-letter | WP-8.4 |
| TP-W8-016 | Endpoint slow (30 s) | Timeout; retry scheduled | WP-8.4 |
| TP-W8-017 | Delivery retried after success response lost | Consumer dedupes by event ID (documented contract) | WP-8.4 |
| TP-W8-018 | Delivery log UI shows attempts | Each attempt, status, response code; no secret shown | WP-8.10 |

### 3.3 Pagination, reports, exports

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W8-019 | List with page size above maximum | Rejected or clamped per documented rule | WP-8.5 |
| TP-W8-020 | Walk all pages of 10,000 clicks | No duplicates or gaps while new rows are inserted | WP-8.5 |
| TP-W8-021 | Invalid cursor | `VALIDATION_FAILED` | WP-8.5 |
| TP-W8-022 | Report totals | Each total carries currency and `as_of` | WP-8.6 |
| TP-W8-023 | Export lifecycle | `accepted` → `processing` → `completed`; download link expires | WP-8.7 |
| TP-W8-024 | Export failure | `failed` with reason; retry creates new export | WP-8.7 |
| TP-W8-025 | Download link after expiry | Rejected | WP-8.7 |

### 3.4 Contract and compatibility

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W8-026 | Published OpenAPI matches server routes | No diff | WP-8.8 |
| TP-W8-027 | Breaking change (remove field) in PR | CI fails with diff | WP-8.8 |
| TP-W8-028 | Every command accepts `Idempotency-Key` where spec requires | Enumerated test passes | WP-8.8, WP-1.10 |
| TP-W8-029 | Error codes in OpenAPI match spec §7.1 | Set equality | WP-8.8 |

### 3.5 Reference consumer

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W8-030 | Reference consumer runs report flow from public docs | Completes; no undocumented calls | WP-8.9 |
| TP-W8-031 | Reference consumer runs webhook flow | Receives and verifies signed payload | WP-8.9 |
| TP-W8-032 | Reference consumer runs key rotation | Old key rejected after grace; new key works | WP-8.9 |

### 3.6 Screens

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W8-033 | Create key form; secret reveal | Shown once with copy; warning announced | WP-8.10 |
| TP-W8-034 | Key list empty state | Clear call to action | WP-8.10 |
| TP-W8-035 | Webhook creation with private IP | Inline error explains why | WP-8.10 |

## 4. Exit criteria

- All TP-W8 green.
- Reference consumer passes TP-W8-030 to 032 using public docs only (Project plan M7 gate).
- OpenAPI published and frozen for v1.

## 5. Test data

- Keys: full scope, read-only, expired, revoked, rotated-in-grace.
- Webhook receiver: local test server that can return 200, 500, delay, and record payloads.

## 6. Risks

- SSRF guard bypass via DNS rebinding. Resolve and pin the IP at connect time; add a test with a rebinding resolver fake.
