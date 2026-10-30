# Moneytrap — Cross-Implementation Conformance Cases

These cases are intended to be runnable against *any* implementation of the Moneytrap behavior contract. A test harness may exercise public operations and UI, while a fixture network/payout simulator supplies deterministic external evidence. Nothing here requires a specific test framework or storage engine.

## Identity, access, and publisher lifecycle

| ID | Given | When | Must hold |
|---|---|---|---|
| CT-001 | Unknown identity hint | Recovery requested | Same visible outcome as known identity; no account enumeration |
| CT-002 | Valid recovery proof | Two concurrent redemptions | Exactly one credential change; all further uses fail |
| CT-003 | Expired recovery proof | Redemption attempted | Credential unchanged; safe retry path |
| CT-004 | Prior active sessions | Password changed through recovery | Sessions invalidated/re-authorized according to documented policy; no bypass of MFA |
| CT-005 | User with membership in org A only | User requests org B resource | No private information or mutation leaks |
| CT-006 | Verified but unapproved property | User creates monetized link | Denied; ownership verification not sufficient |
| CT-007 | Approved publisher/property | Reviewer suspends property | New monetization blocked promptly; historical reporting remains accessible to authorized staff |
| CT-008 | Valid but reused invitation | Reaccept invitation | No duplicated membership |

## Upstream networks, eligibility, and routing

| ID | Given | When | Must hold |
|---|---|---|---|
| CT-009 | Partner credential disabled | Sync requested | Safe failure; no stale program falsely newly approved |
| CT-010 | Offer not permitted in user country/channel | Link created or resolved | Denied or unmonetized fallback; no unauthorized affiliate routing |
| CT-011 | Destination redirects to unsafe/unapproved host | Visitor opens link | Open redirect blocked; no leak of secrets |
| CT-012 | Network report batch replayed | Import repeated | Same normalized source facts; no duplicate commission |
| CT-013 | Click emitted twice | Analytics ingests duplicate | At-most-one logical click fact; legitimate distinct clicks preserved |
| CT-014 | Link revoked while route view stale | Redirect attempted | Effective deny wins over stale allow, within documented revocation guarantee |
| CT-015 | Malformed/unknown provider payload | Import or callback received | Quarantine, audit and alert; no silent approval |

## Conversions, funding, and payouts

| ID | Given | When | Must hold |
|---|---|---|---|
| CT-016 | One approved conversion with documented share policy | Finance posts recognition | All same-currency entries balance and allocate exact total |
| CT-017 | Approved conversion not yet remitted | Publisher views balance | Estimated/approved not shown as available |
| CT-018 | One conversion revised downward | Import latest source revision | New adjustment, source history intact, no duplicate entries |
| CT-019 | Source reverses conversion after publisher payout | Reconciliation occurs | Recoverable deficit or permitted adjustment; prior payment fact preserved |
| CT-020 | Unmatched conversion | Import processes | Staged exception; not arbitrarily assigned to publisher |
| CT-021 | Settlement receipt partially matches source transactions | Finance reconciles | Only matched and eligible portion clears; remainder exception |
| CT-022 | Multiple payout requests against same funds | Concurrent reservations | Funds not over-reserved or paid twice |
| CT-023 | Payment initiation times out | Response becomes unknown | Query original transfer status; no second independent payment |
| CT-024 | Provider callback duplicate/out-of-order | State reconciled | Final state correct and recorded once; conflicting terminal states investigated |
| CT-025 | Payment approver submits own request | Approval attempted | Denied where maker-checker applies; recorded in audit |
| CT-026 | Different currencies | Report rollup requested | Separate amounts or explicit FX transaction; no silent addition |

## API, privacy, Optimize, and operations

| ID | Given | When | Must hold |
|---|---|---|---|
| CT-027 | Revoked scoped credential | Private API requested | Rejected across all affected operations |
| CT-028 | Replayed webhook delivery | Consumer receives twice | Consumer has stable event identity and can deduplicate; provider record unchanged |
| CT-029 | Consent not satisfied | Optional rewrite evaluates page | No restricted rewrite/tracking; original link unchanged |
| CT-030 | Existing merchant affiliate link | Optimize scans page | Publisher-defined protection honored |
| CT-031 | A/B holdout assignment | Same eligible visitor/session evaluated consistently | Holdout does not receive optimized route; reasons inspectable |
| CT-032 | Data subject asks deletion | Valid retention/hold conflict exists | Document lawful hold; erase eligible parts, preserve audit-safe proof |
| CT-033 | Analytics provider unavailable | Redirect receives valid link | Redirect continues where safe; analytics recovers without duplicate facts |
| CT-034 | Reviewer disables network globally | Fresh requests arrive | No monetized route through disabled network |
| CT-035 | Publisher report source data stale | User opens earnings | `stale`/`as_of` clearly visible, not false zero |
| CT-036 | Bulk creation has mixed eligible/ineligible rows | Operation completes | Per-item result and failure reason; retry does not duplicate successes |
| CT-037 | Implementation runtime/storage swapped | Execute same conformance fixtures | Observable outcomes and invariants remain equivalent |

## Exit evidence for any implementation

For each implemented capability provide: an operation contract, logical data mapping, UI state mapping if relevant, happy and error tests, retry/concurrency tests, tenant/access checks, audit/telemetry evidence, and documented deviations that preserve equivalent semantics.

### Example: portable password reset fixture

**Setup:** user U with known initial password, two live sessions, one email contact, and configured recovery policy. Capture the secret recovery proof through a fixture notification sink.

**Action:** submit the request-recovery operation with U's identity, use the received proof exactly once to set a new password, then attempt to use it a second time and attempt to reuse an old session.

**Assert:** request output does not reveal U existence; credential can be changed once; old password cannot authenticate; old sessions fail; new login works only with required assurance; proof cannot be redeemed twice; no secret appeared in generic audit/telemetry events. Repeat with nonexistent user, suspended user, expired proof, concurrent submissions, and notification outage.
