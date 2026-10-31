# Test Plan — Wave 2: Identity and access

**Scope:** WP-2.1 to WP-2.16 · **Milestone:** M1 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W2-###`
**Conformance focus:** CT-001 to CT-005, CT-008

## 1. Objective

Sign-up through invitation works, sessions and recovery are safe under concurrency, MFA is enforced for privileged roles, and tenant isolation holds on every route. Authorization is tested at the route guard, not inside actions.

## 2. Entry criteria

- Wave 1 gate passed.
- Port merge done (WP-2.1, 2.2, 2.8, 2.9, 2.13).
- Notifier dev sink available.

## 3. Test matrix

### 3.1 Identity domain (unit)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-001 | User `pending` → `active` on verify | Allowed | WP-2.1 |
| TP-W2-002 | User `closed` → `active` | Rejected | WP-2.1 |
| TP-W2-003 | Privileged action on `pending` user | Rejected by state rule | WP-2.1 |
| TP-W2-004 | Auth config: minimum password length and breached-password check enabled | Config assertion passes; short and breached passwords rejected by Better Auth in an integration call | WP-2.2 |
| TP-W2-005 | Auth config: no custom hashing; no token or password written to logs | Config and log-scan assertions pass | WP-2.2, §7 |

### 3.2 Registration and verification (action, Postgres, fake notifier)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-006 | Register new email | User `pending`; verification token stored hashed; one notification | WP-2.3 |
| TP-W2-007 | Register known email | Response identical to TP-W2-006 (status, body shape, timing bucket) | WP-2.3, CT-001 |
| TP-W2-008 | Register unknown email | Same as TP-W2-007 | WP-2.3, CT-001 |
| TP-W2-009 | Verify with valid token | User `active`; token consumed | WP-2.3 |
| TP-W2-010 | Verify same token twice | Second rejected | WP-2.3 |
| TP-W2-011 | Verify expired token | Rejected; user stays `pending`; resend path offered | WP-2.3 |
| TP-W2-012 | Token value appears in logs | Never | WP-2.3, §4.4 |

### 3.3 Login, sessions, MFA

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-013 | Login with correct password | Session created; token returned once; hash stored | WP-2.4 |
| TP-W2-014 | Login with wrong password ×N | Rate limit after policy threshold | WP-2.4, WP-2.14 |
| TP-W2-015 | Login by owner role with MFA enrolled | Step-up challenge required before privileged route | WP-2.4 |
| TP-W2-016 | Privileged route with session lacking a recent second factor | Guard returns step-up required error code (code listed in API catalog) | WP-2.4 |
| TP-W2-017 | MFA enroll, confirm with valid code | Factor active | WP-2.6 |
| TP-W2-018 | Recovery code used twice | Second rejected | WP-2.6 |
| TP-W2-019 | Change MFA without step-up | Rejected | WP-2.6 |
| TP-W2-020 | List sessions for own user | Only own sessions | WP-2.7 |
| TP-W2-021 | Revoke a session | Next request with it → `UNAUTHENTICATED` | WP-2.7 |
| TP-W2-022 | Password change | Other sessions revoked per policy; current kept if policy says so | WP-2.7, CT-004 |

### 3.4 Recovery

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-023 | Request recovery for unknown identity | Same visible outcome as known; no enumeration | WP-2.5, CT-001 |
| TP-W2-024 | Two concurrent redemptions of one valid token | Exactly one credential change; other fails | WP-2.5, CT-002 |
| TP-W2-025 | Expired token redemption | Credential unchanged; safe retry path | WP-2.5, CT-003 |
| TP-W2-026 | Redeem after password change by another path | Rejected | WP-2.5 |

### 3.5 Organizations, memberships, invitations

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-027 | Create organization | Creator is owner in same transaction; org row and membership row both exist or neither | WP-2.8 |
| TP-W2-028 | Create organization with client-supplied `owner_id` | Field ignored or rejected; owner is the principal | WP-2.8 |
| TP-W2-029 | Invite member | Invite token hashed; single use; expiry set | WP-2.10 |
| TP-W2-030 | Accept invite twice | One membership; second accept returns already-member outcome | WP-2.10, CT-008 |
| TP-W2-031 | Accept expired invite | Rejected | WP-2.10 |
| TP-W2-032 | Policy table: each role × each action | Matches matrix in spec API catalog | WP-2.9 |

### 3.6 Route guards and tenant isolation (HTTP)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-033 | User of org A requests org B resource | `RESOURCE_NOT_FOUND`; body identical to missing resource | WP-2.11, CT-005 |
| TP-W2-034 | Same request for a nonexistent ID | Identical body and status | WP-2.11, CT-005 |
| TP-W2-035 | Route with no guard declaration | Build-time test fails, listing the route | WP-2.11 |
| TP-W2-036 | Action invoked by route with insufficient permission | Route returns `FORBIDDEN`; action not called (spy) | WP-2.11 |
| TP-W2-037 | Client-supplied `org_id` header for org not joined | Ignored; resolves via membership only | WP-2.11, §4.1 |
| TP-W2-038 | Suspended user with valid session | Next request → `UNAUTHENTICATED` or `FORBIDDEN` per policy | WP-2.1, WP-2.7 |

### 3.7 Concurrency and idempotency

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-039 | Two concurrent invite accepts | One membership | WP-2.10, CT-008 |
| TP-W2-040 | Duplicate register request with same idempotency key | One user | WP-2.3, WP-1.10 |

### 3.8 UI (component and E2E)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-041 | Register form with invalid email | Inline error announced via live region; input value kept | WP-2.15 |
| TP-W2-042 | Login after 429 | Retry-after message shown; no secret echoed | WP-2.15 |
| TP-W2-043 | Step-up screen direct URL when not logged in | Redirect to login; returns to step-up after | WP-2.15 |
| TP-W2-044 | MFA setup shows recovery codes once | Codes visible on this screen only; copy action | WP-2.15 |
| TP-W2-045 | Members list as non-admin | Permission-denied state, not empty list | WP-2.15 |
| TP-W2-046 | Keyboard-only register and verify | Completes without mouse | WP-2.15 |

### 3.9 Conformance

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W2-047 | CT-001 … CT-005, CT-008 in `conf` | All green against in-process app | WP-2.16 |

## 4. Exit criteria

- All TP-W2 green on CI; CT-001–005 and CT-008 green.
- Route guard coverage report: 100% of identity and access routes declared.
- Security review (WP-X.1) has no open high-severity findings.
- Rate limit thresholds recorded as policy values.

## 5. Test data

- Users: owner (MFA on), admin, member, outsider (org B), suspended user.
- Tokens: fixed clock values for expiry tests.

## 6. Risks

- Timing side-channels on known vs unknown email (TP-W2-007/008). Compare response timing bucket with a tolerance; do not assert exact timing.
- Step-up error code: `STEP_UP_REQUIRED` (403) is added to the §7.1 closed set and the guard returns it (WP-2.4). The API catalog must list it before TP-W2-016 is finalized.
- Most credential, session, and recovery behavior is delegated to Better Auth. Tests here cover our configuration and our guards, not the library's cryptography.
