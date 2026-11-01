# Moneytrap — Admin Operations Plan

**Status:** Proposal for owner review. Documents only; no code or Linear changes.
**Reads with:** [Use cases](../legacy/MONEYTRAP_USE_CASES.md) (UC06, UC29), [API catalog](../legacy/MONEYTRAP_API_OPERATIONS.md) (API-069 to API-088, API-099), [Implementation plan](../implementation/IMPLEMENTATION_PLAN.md), [Blueprint](../MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md), [Waves](../implementation/WAVES.md).

Everything below is a proposal. The owner decisions are collected in [§9](#9-decisions-for-the-owner), each with a recommended default.

---

## 1. Summary

- Moneytrap has **tenant roles only**. `Principal` is a user plus organization memberships (`packages/domain/src/access/permissions.ts:109`), and every `permission` guard checks membership in the target organization first (`apps/server/src/http/guards/policy.ts:35`). A platform operator has no way to pass that check.
- `publisher:review` is in the tenant `PERMISSIONS` list but in no role's grant (`permissions.ts:41-43`). `decideReview` is built and tested (`packages/app/src/publisher/decide-review.ts`), and the ops review screens exist in `apps/web/src/features/ops-review/`. **No HTTP route reaches either.** `ROUTE_GUARDS` has no `/admin` entry. Until a staff principal exists, no real publisher can be approved, and every later feature that depends on an approved publisher stays on fakes.
- **Correction to the brief:** admin work does not sit in waves 8 and 9. W8 is the developer platform and W9 is Optimize (legal-gated). Admin work sits in **W3 lane C** (WP-3.8 ops review queue, WP-3.9 minimal audit viewer), **W7 lane D** (WP-7.11 payout ops screens, WP-7.12 payout runbook) and **WP-X.3** (reconciliation job). **UC29 and UC30 have no work package at all.**
- Proposal: add a **staff principal** (a separate type, table, and guard variant), a new **Wave A "Platform administration"** that runs in parallel from now, and a small set of **cross-wave items under OZE-3232** (which is titled "Cross-wave gates (WP-X)") for the pieces that need no staff principal.

---

## 2. Where admin work touches the use cases

| Group | UCs | What the admin work is |
|---|---|---|
| Directly admin | UC06, UC08, UC09, UC15, UC16, UC17, UC19, UC24, UC25, UC29, UC30 | Review queues, integration admin, conversion exceptions, settlements, payout batches, risk flags, privacy requests, ops, launch gates |
| Admin effect or boundary | UC02 (suspended user gets 423; admin needs MFA), UC04 (step-up MFA), UC05 (tenant RBAC must not leak into staff), UC07 (verified property goes to compliance), UC10 (`/admin/integrations` views), UC14 (queue lag and replay), UC22 (webhook DLQ replay), UC26 and UC28 (kill switch, audited manual override), UC31 and UC32 (reviewer approval) | Staff views or decisions over tenant data |
| Consumers of admin output | UC11, UC13 | Honor kill switch and revocation; no admin UI of their own |
| No admin work | UC01, UC03, UC12, UC18, UC20, UC21, UC23, UC27 | — |

Admin API scopes the catalog already names: `admin:reviewer` (API-069 to API-072), `admin:ops` and `admin:ops:mfa`, `admin:finance` (API-075 to API-080), `admin:finance-approver:mfa` (API-081, API-082), `admin:risk` (API-083, API-084), `admin:security:mfa` (API-085 kill switch), `admin:auditor` (API-086), `admin:privacy` (API-087, API-088), `admin:release-approver:mfa`. Proposal: these become the staff roles (§3). API-099 replay is specified as `service:ops`, a service scope; it still needs a named human behind it (Blueprint §9: "each replay writes an audit event").

---

## 3. Platform admin principal

### 3.1 Shape

- A new `StaffPrincipal { userId, staffRoles }` type, **not** a `Principal` with an extra membership. Staff permissions live in their own list (`STAFF_PERMISSIONS`), separate from `PERMISSIONS`, and `can()` never sees them.
- A new guard variant `{ access: "staff"; permission: StaffPermission }`. It has no `ScopeResolver`: staff routes are global, and the organization comes from the resource, not from the caller. `decide()` and the route-coverage test treat it like any other guard, so a staff route with no entry still fails the build.
- Storage: a `platform_staff` table (`user_id` primary key, `roles`, `granted_by`, `granted_at`, `revoked_at`). It is a separate table from Better Auth's `organization`/`member` tables, so no organization flow can write it.
- Staff roles (proposal, from the API catalog scopes): `reviewer`, `ops`, `finance`, `finance_approver`, `risk`, `security`, `auditor`, `privacy`, and a later `support`. A staff user can hold several.
- `publisher:review` moves out of the tenant list into `STAFF_PERMISSIONS` as the `reviewer` grant. `access.ts` builds the Better Auth organization access control from `PERMISSIONS`, so removing it there also removes it from Better Auth's tenant statements.

### 3.2 How it is granted

| Option | Verdict |
|---|---|
| **Bootstrap seed** (`--seed-staff <email>` startup flag, like `--migrate`) | Proposed for the **first** `security` staff member only. Needs database or deploy access, which the operator already has. Writes an audit row. |
| **Second-factor-protected grant** (staff API, recent second factor, second staff approver for `security`, `finance_approver`, `support`) | Proposed for **every grant after the first**. |
| **Env allowlist** (`STAFF_EMAILS=...`) | Not proposed as a grant source. A change is a deploy, leaves no audit row, needs no second factor, and an email match is only as strong as email verification. At most usable as a ceiling, for example a `STAFF_EMAIL_DOMAINS` list that grants may not exceed. |

### 3.3 Keeping tenants and staff apart

1. **Separate account, enforced.** Grant refuses a user who holds any organization membership, and the invitation-accept and organization-create paths refuse a user who is staff. Staff use a dedicated account; a tenant owner is never promoted, a new account is granted.
2. **No route from membership to staff.** Nothing reads `member.role` to build a `StaffPrincipal`. The grant endpoint is under `/api/admin/*`, outside `/api/auth/*`, so Better Auth's organization endpoints cannot reach it.
3. **Checked on every request**, from the database, not from the session or a cookie. Revocation takes effect on the next request. Suspended users fail (`isActive`, `user.ts:42`).
4. **MFA required to be staff.** The user must have a confirmed second factor; mutations need `requireRecentSecondFactor` (`guards/assurance.ts`). Proposed: a shorter step-up window than tenants.
5. **No API-key sessions.** `apiKey({ enableSessionForAPIKeys: true })` (`auth/config.ts:476`) lets a key stand in for a session. Staff guards must reject any session that came from a key. This needs confirming in the implementation.
6. **No self-review.** A staff user cannot decide on a publisher or property in an organization where they hold a membership (belt and braces with rule 1). Cannot grant themselves a role; cannot grant a role they do not hold.
7. **Non-staff get 404**, not 403, on `/api/admin/*`, so the surface is not disclosed (the same rule as CT-005).
8. **Audit:** `actor.type = "staff"`, `actor.id`, the staff role used, `organization_id` of the affected tenant (nullable for platform events), and the reason. Append-only per Blueprint §7.

Better Auth also ships an `admin` plugin (role on the user row, ban, impersonate). Proposal: do **not** adopt it for this. It stores the role on `user`, the same row a tenant owner controls their profile on. Confirm in the implementation spike before ruling it out for ban/impersonation helpers.

---

## 4. `publisher:review`: queue, decision, audit

**Holder:** staff role `reviewer`. No tenant role ever holds it.

| Piece | Proposal |
|---|---|
| Queue | `GET /api/admin/publishers/review-queue` (API-069). `in_review` publishers, oldest first, cursor-paged. Shows organization, country, provider reference, risk signals, evidence references. No raw KYB documents (UC06 step 3). |
| Decision | `POST /api/admin/publishers/:id/decision` (API-070). Body `{ decision: approve \| reject, reason }`, idempotency key, recent second factor. Wires the existing `decideReview`. |
| Change to the action | `decideReview` takes `organizationId` from a tenant scope. For staff it is read from the publisher record (`store.find`), then the self-review check runs. The status and audit row are already one transaction (`publisher-review-store.ts`). |
| Failures | Blank reason → `VALIDATION_FAILED`. Not `in_review`, or status changed since read → `STATE_CONFLICT`. Unknown id → `RESOURCE_NOT_FOUND`. Provider unavailable → stays `in_review`, never auto-approves (UC06). |
| Notification | Publisher gets a status notice through the outbox (UC06 step 5). |
| Audit | `approve` / `reject` rows exist (reason in `metadata`). Add `actor.type=staff` and the staff role. Add `staff.evidence.viewed` when a reviewer opens an evidence link. Viewing the queue itself is not audited. |
| Properties | API-071 and API-072 have the same gap (`admin:reviewer`). Same WP, same guard. |
| Known gap | A rejected publisher is terminal; "resubmission is not modelled" (`domain/src/publisher/publisher.ts:33`), but UC06 requires a resubmission route. Tracked in PA-10. |

---

## 5. UC29 operations: blocked or not

| UC29 piece | Needs staff principal? | Why |
|---|---|---|
| Request and trace IDs; dashboards for redirect latency, queue lag, import freshness, unmatched receipts, journal imbalance | **No** | Metrics and dashboards are code in `ops/` (Blueprint §9). `request-id.ts` exists. |
| Alert rules (sustained breach, route revocation failure) | **No** | Alerting reads metrics, not users. |
| SLO and error-budget view | **No** | Same. |
| Readiness and liveness (`/readyz`) | **No** | Exists. |
| Runbooks and incident classification | **No** | `docs/runbooks/` does not exist yet; WP-7.12 is the only planned runbook. |
| Restore drill (backup restore, ledger-total check, RTO/RPO) | **No** | Infrastructure procedure; reuse WP-X.3 reconciliation as the totals check. |
| Operational health screen in the console (UI-075), adapter monitoring (UI-076) | **Yes** | Logged-in staff view of cross-tenant data. |
| Audit log search (UI-077, API-086) | **Yes** | Cross-tenant read. Today's `listReviewDecisionAudit` is organization-scoped and review-only. |
| Dead-letter inspection and replay (API-099) | **Yes** | Needs a named operator and an audit row (Blueprint §9). |
| Reversible kill switch (API-085) | **Yes** | `admin:security:mfa`. |
| Feature flags and launch cohort (UC30) | **Yes** | Same principal; also legal-gated for rollout flags. |
| Alert test that does not page customers | **No** | Notification gating is a code rule. |

Proposal: do **not** build an interim replay or kill-switch path that skips the staff principal. Both are the highest-risk admin actions, and the principal is a small package (PA-1, PA-2). Ship the no-principal items first, in parallel (§7).

---

## 6. New use cases

Numbering `ADM-1` to `ADM-7` is local to this plan so it does not collide with UC01 to UC32. Each is a proposal for the use-case document; none is accepted yet. Gate labels: **SEC** = `needs-security-review`, **FIN** = `needs-finance-review`, **LEGAL** = `legal-gate`. I could not find these three labels in the Linear workspace label list; they need creating, and `AGENTS.md` only defines the finance review today.

### ADM-1 — Grant and revoke platform staff — risk: **security** — gates: SEC

- **Actor:** bootstrap operator (first grant); a `security` staff member after that.
- **Trigger:** new hire, role change, departure, incident.
- **Steps:** (1) Target must be a verified, MFA-enrolled, active user with no organization membership. (2) Actor supplies roles and a reason and passes a recent second factor. (3) For `security`, `finance_approver`, `support`: a second staff member approves. (4) Row written; target's other sessions revoked on revoke. (5) Revoke is immediate.
- **Failures:** target has a membership; no MFA; self-grant; granting a role you do not hold; revoking the last `security` staff; concurrent edit (version check); approver equals requester.
- **Audit:** `staff.bootstrap.seeded`, `staff.granted`, `staff.role_changed`, `staff.revoked`, `staff.grant_denied`.

### ADM-2 — Platform user suspension and reinstatement — risk: **security, legal** — gates: SEC, LEGAL

- **Actor:** `security` staff.
- **Trigger:** confirmed account takeover, fraud finding, legal or regulator request.
- **Steps:** (1) Staff opens the user, enters a reason, passes a recent second factor. (2) `suspendUser` (active → suspended; exists in `domain/identity/user.ts`). (3) All sessions and API keys of the user stop working; login returns 423 (UC02). (4) Tenant data is untouched. (5) Reinstatement is `reinstateUser`, by a different staff member. (6) User gets a notice and an appeal route.
- **Failures:** target is staff (use ADM-1); target is the last owner of an organization (flag the organization, do not block the suspension); already suspended (idempotent no-op); closed account cannot reactivate; concurrent change.
- **Audit:** `user.suspended`, `user.reinstated`, `session.revoked_bulk`, `apikey.disabled_bulk`.
- **Notes:** suspension does not move money. Payout holds stay on the existing finance path (UC24). The notice wording and appeal route are the legal question.

### ADM-3 — Audit log search — risk: **security, legal (privacy)** — gates: SEC, LEGAL

- **Actor:** `auditor` staff (read-only).
- **Trigger:** incident review, dispute, compliance request.
- **Steps:** (1) Filter by entity type, actor, organization, action, time range (API-086 plus organization and action). (2) Cursor-paged results with actor, scope, reason, time, object (UI-077). (3) Metadata shown through an allowlist, so free-text reasons are not a path for PII or secrets.
- **Failures:** range too wide or page size over the cap → `VALIDATION_FAILED`; non-auditor → 404; stale data labelled `data_stale`.
- **Audit:** `audit.searched` (filters used, not results). Searching the audit log is itself audited, because it is a cross-tenant read.
- **Notes:** export is out of scope for the first cut. Retention follows the legal schedule (UC25).

### ADM-4 — Feature flags and kill switch — risk: **security, finance, legal** — gates: SEC, FIN (flags touching payouts or ledger), LEGAL (country or Optimize rollout flags)

- **Actor:** `security` staff for safety flags (kill switch, API-085); `ops` staff for rollout flags (UC30).
- **Trigger:** incident (disable a network, program, property, or all routing); planned canary.
- **Steps:** (1) Pick scope (`global`, `network`, `property`, `country_channel`) and key (DM-067). (2) Send the new value with the expected `version`, a reason, and a recent second factor. (3) Commit, then publish the invalidation directly (ADR-007), not through the outbox. (4) Response states the propagation window (API-085: ≤60 s; Blueprint §5.3 targets ≤5 s). (5) Reversing is the same command.
- **Failures:** stale version → `STATE_CONFLICT`; unknown key or unsupported channel → `VALIDATION_FAILED`; flag store unreadable → safety flags fail closed (deny); publish missed → the freshness backstop bounds it; disabling does not delete conversions or financial history (UC30).
- **Audit:** `flag.changed` (old and new value, scope, version, reason), `routing.revoked`.

### ADM-5 — Support impersonation with consent — risk: **security, legal** — gates: SEC, LEGAL

- **Actor:** `support` staff; a tenant `owner` grants consent.
- **Trigger:** a support ticket the customer cannot resolve with screenshots.
- **Steps:** (1) Owner grants a support access window (proposal: read-only, ≤1 hour, tied to a ticket reference) from their settings. (2) Staff starts a "view as" session with a recent second factor. (3) The UI shows a persistent banner. (4) Every request is logged against both identities. (5) The session ends at expiry, revocation, or staff logout.
- **Failures:** no or expired consent; consent revoked mid-session (session ends at once); target is staff; target organization suspended; an attempted write (denied and logged). **Never allowed even with consent:** password or MFA change, payout methods, payout or ledger actions, API key or webhook secret reveal or create, invitations.
- **Audit:** `support.grant_requested`, `support.grant_given`, `support.grant_revoked`, `support.session_started`, `support.session_ended`, `support.read` (route and object), `support.action_denied`.
- **Notes:** the largest legal and security exposure in this plan; the plan sequences it last. Not building it is a valid outcome ([§9](#9-decisions-for-the-owner), decision 7).

### ADM-6 — Dead-letter queue inspection and replay — risk: **finance, security** — gates: FIN, SEC

- **Actor:** `ops` staff; a second staff member (`finance_approver`) for money-affecting job types.
- **Trigger:** `job_failures` alert (DM-058), or the queue screen (UI-075).
- **Steps:** (1) List failures by `job_type`, `queue_name`, `error_code`, age. Payloads are references, not bodies. (2) Pick failures, run a **dry run**: which handlers would run, which events the consumer has already processed (`inbox_processed_events`). (3) Replay with a reason. Replay re-sends the **original `event_id`**, so consumer dedupe stops duplicate effects (Blueprint §5.4). (4) Result per failure.
- **Failures:** job type not on the replayable allowlist → `VALIDATION_FAILED`; event already processed → no-op reported; replay fails again → stays in the queue with `attempts` increased; concurrent replay of the same failure → one wins (`STATE_CONFLICT`). A payout in `unknown` is never replayed; it follows the payout runbook (CT-019, WP-7.12).
- **Audit:** `dlq.replay_dry_run`, `dlq.replay_requested`, `dlq.replay_completed`, `dlq.replay_failed`, `dlq.payload_viewed`.

### ADM-7 — Publisher re-review after a material change — risk: **legal, finance** — gates: LEGAL, FIN

- **Actor:** system trigger; `reviewer` staff decides.
- **Trigger:** change to legal name, country, beneficial owner, or KYB provider status; change of payout country or method; a high-severity risk flag; periodic refresh.
- **Steps:** (1) A change-set is detected and recorded once (idempotent per change). (2) The publisher enters a re-review state. (3) It appears in the same queue as §4 and is tagged as a re-review with the diff. (4) Reviewer approves or rejects with a reason. (5) Payouts for the publisher are held while a payout-relevant change is pending.
- **Failures:** KYB provider unavailable → stays pending, never auto-approves; further change during review → same item updated; reviewer is a member of the organization → blocked; deadline passed with no decision → restriction applies (model is decision 6).
- **Audit:** `publisher.change_flagged`, `publisher.rereview_opened`, `approve` / `reject` with reason, `publisher.restricted`, `payout.hold_placed`.
- **Notes:** "material" is a compliance definition, not an engineering one. Includes the missing resubmission route for rejected publishers.

---

## 7. Work packages

Proposed IDs are placeholders: `PA-n` for a new **Wave A "Platform administration"** that runs in parallel and is **not** sequenced after W9, and `PX-n` for cross-wave items under **OZE-3232**. Real WP IDs (`WP-A.n`, `WP-X.n` continuing after WP-X.5) are assigned when the issues are created; the placeholders avoid the `WP-` prefix so `check:docs` does not read them as defined work packages. Sizes: S ≈ days, M ≈ 1–2 weeks, L ≈ 2+ weeks, one owner. I am not creating any Linear issue.

| WP | Title | Covers | Depends on | Size | Gates |
|---|---|---|---|---|---|
| **PA-1** | Staff principal: domain type, `STAFF_PERMISSIONS`, `staff` guard variant, `platform_staff` migration, move `publisher:review` out of tenant list, route-coverage rule. Port-first PR. | Gap 1, 2 | W2, W3 merged | M | SEC |
| **PA-2** | Staff session rules: `--seed-staff`, MFA and step-up on staff routes, per-request lookup, reject API-key sessions, 404 for non-staff | Gap 1 | A.1 | M | SEC |
| **PA-3** | Staff grant and revoke (ADM-1) with second approver | Gap 1 | A.2 | M | SEC |
| **PA-4** | Publisher and property review routes (API-069 to API-072); wire `decideReview`; self-review block; connect `ops-review` UI to the real API; publisher notice | Gap 2 | A.2 | M | SEC |
| **PA-5** | Audit log search (ADM-3): cross-tenant query, allowlist, `audit.searched` | UC29 | A.2 | M | SEC, LEGAL |
| **PA-6** | Platform user suspension and reinstatement (ADM-2) | New | A.2 | M | SEC, LEGAL |
| **PA-7** | DLQ list and detail, read-only (ADM-6 part 1) | UC29 | A.2 | S | SEC |
| **PA-8** | DLQ dry-run and replay, replayable allowlist, second approver (ADM-6 part 2) | UC29 | A.7, A.3 | L | FIN, SEC |
| **PA-9** | Feature flags and kill switch (ADM-4), launch cohort flags for UC30 | UC29, UC30 | A.2, W5 route view | L | SEC, FIN, LEGAL |
| **PA-10** | Publisher re-review and rejected-publisher resubmission (ADM-7) | New, UC06 gap | A.4, decision 6 | L | LEGAL, FIN |
| **PA-11** | Support impersonation (ADM-5) | New | A.3, A.5, A.6 | L | SEC, LEGAL |
| **PX-1** | Operational dashboards, alert rules, and SLO view as code in `ops/` | UC29 | none | M | — |
| **PX-2** | Runbooks: disable network/program/link, replay import, rotate credential, incident classification | UC29 | none | S | — |
| **PX-3** | Restore drill with ledger-total check and measured RTO/RPO | UC29 | WP-X.3 | M | FIN |
| **PX-4** | Security review of the staff principal and staff routes | Gap 1 | A.1 to A.4 | S | SEC |

### Order

1. **Now, in parallel:** PX-1, PX-2, PX-3 (no principal needed). PA-1.
2. **After A.1:** PA-2, then PX-4 once A.1 to A.4 land.
3. **After A.2, in parallel:** PA-3, PA-4, PA-5, PA-7.
4. **Then:** PA-6; PA-8 (needs A.3 and A.7); PA-9.
5. **Last:** PA-10 (needs decision 6), PA-11 (needs decisions 7 and the legal sign-off).

**Timing rule (proposal):** PA-1 to PA-4 merge before the first real publisher is onboarded. Until then every approval runs on fakes, so the W3 exit gate ("ten synthetic publishers reviewed") does not prove the real path.

---

## 8. Risks of this plan

- A.1 touches `domain/src/access`, which `WAVES.md` §7 already puts behind finance and auth reviewers. Expect both on that PR.
- Moving `publisher:review` changes the tenant `Permission` type. `policy.test.ts`, `permissions.test.ts`, and `access.ts` reference it and need updating in the same PR.
- PA-9 and PA-8 are the most dangerous actions in the system. They are sequenced after the principal, the audit search, and the second-approver flow so those controls exist first.

---

## 9. Decisions for the owner

Each is open. The default is a recommendation only.

| # | Decision | Recommended default |
|---|---|---|
| 1 | How is staff granted? | Seed for the first `security` user only; every later grant through the second-factor-protected API with a second approver for privileged roles. No env allowlist as a grant source. |
| 2 | Must staff use dedicated accounts with no organization membership? | Yes, enforced at grant and at invitation-accept. |
| 3 | Staff role set | Adopt the API catalog scopes (`reviewer`, `ops`, `finance`, `finance_approver`, `risk`, `security`, `auditor`, `privacy`) and add `support` later. |
| 4 | Where does the work live? | New parallel Wave A (`PA-n`), plus PX-1 to PX-4 under OZE-3232. Not a W10 after W9. |
| 5 | Move `publisher:review` out of the tenant `PERMISSIONS` list into a staff list? | Yes. |
| 6 | Re-review model on a material change | Publisher stays `approved` with a re-review pending and a grace deadline; payouts held at once for payout-relevant changes; restriction at the deadline. The alternative, an immediate return to `in_review`, blocks link creation and is stricter. Compliance defines "material". |
| 7 | Build support impersonation? | Defer. If built: read-only, owner consent, ≤1 hour, ticket reference, banner, hard-denied action list. |
| 8 | Reinstating a suspended user needs a different staff member than the suspender? | Yes. |
| 9 | Interim replay or kill switch before PA-9 and PA-8? | No interim path; use runbooks (PX-2) until the principal exists. |
| 10 | Which job types may be replayed, and which need a second approver? | Allowlist, default deny; any ledger, settlement, or payout job type needs a `finance_approver`; payout `unknown` is never replayable. |
| 11 | Audit search retention and PII rule | Follow the legal retention schedule (UC25); metadata allowlist; no export in the first cut. |
| 12 | Create the missing gate labels `needs-security-review` and `legal-gate` in Linear, and define the security review in `AGENTS.md` as the finance review is | Yes. |
