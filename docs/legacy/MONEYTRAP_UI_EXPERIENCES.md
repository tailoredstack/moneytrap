# Moneytrap — Technology-Neutral UI Experience Catalog

A UI experience is defined by what users can see and do. Listed paths are **suggested navigational aliases** from the earlier blueprint, not required framework routes. Native app navigation, web routing, server-rendered views, and other interaction methods may expose the same experience.

## Shared interaction requirements

- Every experience has accessible focus/labels/keyboard support, loading and failure feedback, direct-entry authorization, and clear empty/stale states.
- The display must not imply monetization approval from property ownership verification alone.
- Money must be currency-aware and source-freshness-aware; `unknown` is not shown as `0`.
- A browser/client must not be trusted as the permission authority. All operations are checked again by the authoritative capability.
- Secrets and one-time proofs should not be exposed in telemetry, browser URLs beyond unavoidable short-lived handoff, third-party scripts, referers, error reports, or persisted client state.
- Actions such as deny, suspend, payout approval or network disable must display consequences and require permissions.

## Experiences
### UI-001 — Public account creation.

- **Suggested navigation alias (optional):** `/register`
- **User goal:** Public account creation.
- **Controls / submitted values:** email, password, confirm password, terms version, locale.
- **Required visible states:** validated entry -> submitting -> check-your-email; reused email throttled; keyboard and accessible errors.
- **Related operation examples:** `POST /v1/auth/register`, `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification`.
- **Scenario references:** `UC01`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-002 — Email verification landing.

- **Suggested navigation alias (optional):** `/verify-email`
- **User goal:** Email verification landing.
- **Controls / submitted values:** signed token from inbound link; no user-entered secret.
- **Required visible states:** verifying -> confirmed -> /login; expired/replayed -> resend verification.
- **Related operation examples:** `POST /v1/auth/register`, `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification`.
- **Scenario references:** `UC01`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-003 — Session login.

- **Suggested navigation alias (optional):** `/login`
- **User goal:** Session login.
- **Controls / submitted values:** email, password, remember device?.
- **Required visible states:** submitting -> MFA challenge or dashboard; unknown credentials generic; Forgot password link.
- **Related operation examples:** `POST /v1/auth/register`, `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification`, `POST /v1/auth/login`, `POST /v1/auth/mfa/challenge`, `GET /v1/auth/me`, `POST /v1/auth/logout`, `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`, `GET /v1/auth/sessions`.
- **Scenario references:** `UC01`, `UC02`, `UC03`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-004 — Complete step-up authentication.

- **Suggested navigation alias (optional):** `/mfa/challenge`
- **User goal:** Complete step-up authentication.
- **Controls / submitted values:** challenge_id, supported second-factor or recovery method assertion.
- **Required visible states:** pending -> verifying -> logged-in; expiration or lockout -> /login.
- **Related operation examples:** `POST /v1/auth/login`, `POST /v1/auth/mfa/challenge`, `GET /v1/auth/me`, `POST /v1/auth/logout`.
- **Scenario references:** `UC02`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-005 — Publisher overview and onboarding status.

- **Suggested navigation alias (optional):** `/dashboard`
- **User goal:** Publisher overview and onboarding status.
- **Controls / submitted values:** organization selection, reports summary, onboarding CTA.
- **Required visible states:** authenticated loading, no-org onboarding, suspended restricted, stale data marked.
- **Related operation examples:** `POST /v1/auth/login`, `POST /v1/auth/mfa/challenge`, `GET /v1/auth/me`, `POST /v1/auth/logout`, `GET /v1/reports/clicks`, `GET /v1/reports/conversions`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`.
- **Scenario references:** `UC02`, `UC23`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-006 — Account security overview.

- **Suggested navigation alias (optional):** `/settings/security`
- **User goal:** Account security overview.
- **Controls / submitted values:** password change; MFA factor status; session list.
- **Required visible states:** requires re-auth for sensitive actions; success notice; session expiry routing.
- **Related operation examples:** `POST /v1/auth/login`, `POST /v1/auth/mfa/challenge`, `GET /v1/auth/me`, `POST /v1/auth/logout`, `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`, `GET /v1/auth/sessions`, `POST /v1/auth/mfa/enroll`, `POST /v1/auth/mfa/confirm`, `DELETE /v1/auth/sessions/{session_id}`.
- **Scenario references:** `UC02`, `UC03`, `UC04`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-007 — Request recovery email.

- **Suggested navigation alias (optional):** `/forgot-password`
- **User goal:** Request recovery email.
- **Controls / submitted values:** email.
- **Required visible states:** always show neutral success after 202; network failure shows retry; cooldown visible.
- **Related operation examples:** `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`, `POST /v1/auth/login`, `GET /v1/auth/sessions`.
- **Scenario references:** `UC03`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-008 — Use single-use password recovery token.

- **Suggested navigation alias (optional):** `/reset-password?token=...&email=...`
- **User goal:** Use single-use password recovery token.
- **Controls / submitted values:** new_password, new_password_confirmation, token/email URL parameters.
- **Required visible states:** initial -> form -> submitting -> /login?reset=success; invalid/expired -> /forgot-password; Referrer-Policy no-referrer; no analytics.
- **Related operation examples:** `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`, `POST /v1/auth/login`, `GET /v1/auth/sessions`.
- **Scenario references:** `UC03`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-009 — MFA setup and recovery.

- **Suggested navigation alias (optional):** `/settings/security/mfa`
- **User goal:** MFA setup and recovery.
- **Controls / submitted values:** enrollment method, proof, recovery codes shown once.
- **Required visible states:** pending QR -> proof -> recovery backup -> complete; invalid code retry.
- **Related operation examples:** `POST /v1/auth/mfa/enroll`, `POST /v1/auth/mfa/confirm`, `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{session_id}`.
- **Scenario references:** `UC04`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-010 — Manage authenticated devices.

- **Suggested navigation alias (optional):** `/settings/security/sessions`
- **User goal:** Manage authenticated devices.
- **Controls / submitted values:** revoke session ID, optional revoke all.
- **Required visible states:** current and remote sessions, confirm revoke, 401 after own session revoked.
- **Related operation examples:** `POST /v1/auth/mfa/enroll`, `POST /v1/auth/mfa/confirm`, `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{session_id}`.
- **Scenario references:** `UC04`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-011 — Initial publisher organization.

- **Suggested navigation alias (optional):** `/onboarding/organization`
- **User goal:** Initial publisher organization.
- **Controls / submitted values:** name, country ISO2, base currency ISO3.
- **Required visible states:** empty -> valid -> create -> /onboarding/publisher; validation and retry errors.
- **Related operation examples:** `POST /v1/organizations`, `POST /v1/invitations`, `POST /v1/invitations/accept`, `GET /v1/members`, `DELETE /v1/members/{member_id}`.
- **Scenario references:** `UC05`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-012 — Org legal/business settings.

- **Suggested navigation alias (optional):** `/settings/organization`
- **User goal:** Org legal/business settings.
- **Controls / submitted values:** trade name, legal name, currency policy.
- **Required visible states:** read-only for viewer; owner update with audit and confirmation.
- **Related operation examples:** `POST /v1/organizations`, `POST /v1/invitations`, `POST /v1/invitations/accept`, `GET /v1/members`, `DELETE /v1/members/{member_id}`.
- **Scenario references:** `UC05`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-013 — Membership management.

- **Suggested navigation alias (optional):** `/settings/team`
- **User goal:** Membership management.
- **Controls / submitted values:** invite email, role, removal action.
- **Required visible states:** send invitation, status pending/accepted, duplicate and last-owner errors.
- **Related operation examples:** `POST /v1/organizations`, `POST /v1/invitations`, `POST /v1/invitations/accept`, `GET /v1/members`, `DELETE /v1/members/{member_id}`.
- **Scenario references:** `UC05`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-014 — Invitation acceptance.

- **Suggested navigation alias (optional):** `/invitations/accept?token=...`
- **User goal:** Invitation acceptance.
- **Controls / submitted values:** invite token.
- **Required visible states:** validate -> accept -> selected org; expiry and unauthorized states.
- **Related operation examples:** `POST /v1/organizations`, `POST /v1/invitations`, `POST /v1/invitations/accept`, `GET /v1/members`, `DELETE /v1/members/{member_id}`.
- **Scenario references:** `UC05`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-015 — Publisher compliance onboarding.

- **Suggested navigation alias (optional):** `/onboarding/publisher`
- **User goal:** Publisher compliance onboarding.
- **Controls / submitted values:** business type, provider reference and consent acknowledgement.
- **Required visible states:** draft -> submitted -> under review; rejection guidance.
- **Related operation examples:** `POST /v1/publishers/submit`, `GET /v1/publishers/status`, `GET /v1/admin/publishers/review-queue`, `POST /v1/admin/publishers/{id}/decision`.
- **Scenario references:** `UC06`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-016 — Account approval progress.

- **Suggested navigation alias (optional):** `/onboarding/review`
- **User goal:** Account approval progress.
- **Controls / submitted values:** none; status polling.
- **Required visible states:** in_review/approved/rejected/suspended with reason and support route.
- **Related operation examples:** `POST /v1/publishers/submit`, `GET /v1/publishers/status`, `GET /v1/admin/publishers/review-queue`, `POST /v1/admin/publishers/{id}/decision`.
- **Scenario references:** `UC06`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-017 — Reviewer list.

- **Suggested navigation alias (optional):** `/admin/publishers`
- **User goal:** Reviewer list.
- **Controls / submitted values:** status, country, risk and cursor filters.
- **Required visible states:** approve/reject accessible only to reviewer; audit notes.
- **Related operation examples:** `POST /v1/publishers/submit`, `GET /v1/publishers/status`, `GET /v1/admin/publishers/review-queue`, `POST /v1/admin/publishers/{id}/decision`.
- **Scenario references:** `UC06`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-018 — Publisher KYB decision.

- **Suggested navigation alias (optional):** `/admin/publishers/[id]`
- **User goal:** Publisher KYB decision.
- **Controls / submitted values:** decision, reason_code, evidence_ref.
- **Required visible states:** history timeline, approve/reject, non-self-review policy.
- **Related operation examples:** `POST /v1/publishers/submit`, `GET /v1/publishers/status`, `GET /v1/admin/publishers/review-queue`, `POST /v1/admin/publishers/{id}/decision`.
- **Scenario references:** `UC06`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-019 — Property inventory.

- **Suggested navigation alias (optional):** `/properties`
- **User goal:** Property inventory.
- **Controls / submitted values:** type, country, status filters.
- **Required visible states:** cursor list, empty create CTA, pause/unpause guarded.
- **Related operation examples:** `POST /v1/properties`, `POST /v1/properties/{id}/verification-challenge`, `POST /v1/properties/{id}/verify`, `POST /v1/properties/{id}/submit`, `GET /v1/properties/{id}`.
- **Scenario references:** `UC07`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-020 — Register traffic source.

- **Suggested navigation alias (optional):** `/properties/new`
- **User goal:** Register traffic source.
- **Controls / submitted values:** property type, identifier, country, channel.
- **Required visible states:** conditional website/social/app/API fields; preview normalization before submit.
- **Related operation examples:** `POST /v1/properties`, `POST /v1/properties/{id}/verification-challenge`, `POST /v1/properties/{id}/verify`, `POST /v1/properties/{id}/submit`, `GET /v1/properties/{id}`, `POST /v1/links`, `POST /v1/api-keys`.
- **Scenario references:** `UC07`, `UC32`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-021 — Traffic source verification instructions.

- **Suggested navigation alias (optional):** `/properties/[id]/verify`
- **User goal:** Traffic source verification instructions.
- **Controls / submitted values:** DNS TXT, HTML/meta challenge or manual evidence.
- **Required visible states:** show exact challenge and check progress; initial page renderingF-safe validation; expiry/retry.
- **Related operation examples:** `POST /v1/properties`, `POST /v1/properties/{id}/verification-challenge`, `POST /v1/properties/{id}/verify`, `POST /v1/properties/{id}/submit`, `GET /v1/properties/{id}`, `POST /v1/links`, `POST /v1/api-keys`.
- **Scenario references:** `UC07`, `UC32`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-022 — Property review progress.

- **Suggested navigation alias (optional):** `/properties/[id]/review`
- **User goal:** Property review progress.
- **Controls / submitted values:** none.
- **Required visible states:** pending/approved/rejected/suspended states; failed verification explanation.
- **Related operation examples:** `POST /v1/properties`, `POST /v1/properties/{id}/verification-challenge`, `POST /v1/properties/{id}/verify`, `POST /v1/properties/{id}/submit`, `GET /v1/properties/{id}`.
- **Scenario references:** `UC07`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-023 — Compliance property review.

- **Suggested navigation alias (optional):** `/admin/properties`
- **User goal:** Compliance property review.
- **Controls / submitted values:** status, source, country.
- **Required visible states:** asynchronous delivery workflow, split detail, approve/reject reason and audit history.
- **Related operation examples:** `GET /v1/admin/properties/review-queue`, `POST /v1/admin/properties/{id}/decision`, `POST /v1/properties/{id}/disable`, `POST /v1/admin/kill-switch`, `GET /v1/admin/integrations`, `GET /internal/health/ready`.
- **Scenario references:** `UC08`, `UC30`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-024 — Property evidence and decision.

- **Suggested navigation alias (optional):** `/admin/properties/[id]`
- **User goal:** Property evidence and decision.
- **Controls / submitted values:** decision, reason_code, evidence_ref.
- **Required visible states:** review approval or suspension; network terms cross-check.
- **Related operation examples:** `GET /v1/admin/properties/review-queue`, `POST /v1/admin/properties/{id}/decision`, `POST /v1/properties/{id}/disable`.
- **Scenario references:** `UC08`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-025 — Property details and integration status.

- **Suggested navigation alias (optional):** `/properties/[id]`
- **User goal:** Property details and integration status.
- **Controls / submitted values:** property details, verify/review controls, disable confirmation.
- **Required visible states:** pending/approved/rejected/suspended, approved channel and links summary.
- **Related operation examples:** `GET /v1/admin/properties/review-queue`, `POST /v1/admin/properties/{id}/decision`, `POST /v1/properties/{id}/disable`.
- **Scenario references:** `UC08`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-026 — Network connector status.

- **Suggested navigation alias (optional):** `/admin/integrations`
- **User goal:** Network connector status.
- **Controls / submitted values:** network selection.
- **Required visible states:** contract gate, account health, last sync and sync error.
- **Related operation examples:** `GET /v1/admin/integrations`, `POST /v1/admin/integrations/{id}/sync`, `POST /v1/admin/kill-switch`, `GET /internal/health/ready`.
- **Scenario references:** `UC09`, `UC30`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-027 — Partner adapter and import history.

- **Suggested navigation alias (optional):** `/admin/integrations/[id]`
- **User goal:** Partner adapter and import history.
- **Controls / submitted values:** network resource, dry_run.
- **Required visible states:** no secret in UI, sync cursors, failure replay.
- **Related operation examples:** `GET /v1/admin/integrations`, `POST /v1/admin/integrations/{id}/sync`, `GET /v1/advertisers`, `GET /v1/programs`, `GET /v1/programs/{id}`, `POST /v1/programs/{id}/request-approval`.
- **Scenario references:** `UC09`, `UC10`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-028 — Search merchant directory.

- **Suggested navigation alias (optional):** `/advertisers`
- **User goal:** Search merchant directory.
- **Controls / submitted values:** q, country, channel, property selector.
- **Required visible states:** only eligible programs clickable; freshness disclosure.
- **Related operation examples:** `GET /v1/advertisers`, `GET /v1/programs`, `GET /v1/programs/{id}`, `POST /v1/programs/{id}/request-approval`.
- **Scenario references:** `UC10`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-029 — Merchant details.

- **Suggested navigation alias (optional):** `/advertisers/[id]`
- **User goal:** Merchant details.
- **Controls / submitted values:** property selector, link CTA.
- **Required visible states:** program list with approved/pending/restricted and policy reason.
- **Related operation examples:** `GET /v1/advertisers`, `GET /v1/programs`, `GET /v1/programs/{id}`, `POST /v1/programs/{id}/request-approval`, `POST /v1/links`, `GET /v1/links`, `GET /v1/links/{id}`, `PATCH /v1/links/{id}`, `POST /v1/links/{id}/disable`.
- **Scenario references:** `UC10`, `UC11`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-030 — Program terms and eligibility.

- **Suggested navigation alias (optional):** `/programs/[id]`
- **User goal:** Program terms and eligibility.
- **Controls / submitted values:** property selector, approval request.
- **Required visible states:** terms version, accepted channels, unknown/ineligible denied.
- **Related operation examples:** `GET /v1/advertisers`, `GET /v1/programs`, `GET /v1/programs/{id}`, `POST /v1/programs/{id}/request-approval`.
- **Scenario references:** `UC10`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-031 — Manage manual affiliate links.

- **Suggested navigation alias (optional):** `/links`
- **User goal:** Manage manual affiliate links.
- **Controls / submitted values:** status, property, search, cursor.
- **Required visible states:** copy short URL, disable, link details and click summary.
- **Related operation examples:** `POST /v1/links`, `GET /v1/links`, `GET /v1/links/{id}`, `PATCH /v1/links/{id}`, `POST /v1/links/{id}/disable`.
- **Scenario references:** `UC11`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-032 — Create deep link.

- **Suggested navigation alias (optional):** `/links/new`
- **User goal:** Create deep link.
- **Controls / submitted values:** property_id, destination_url, optional program_id, expiry.
- **Required visible states:** validate -> eligibility preview -> create -> copy short URL; errors preserve fields.
- **Related operation examples:** `POST /v1/links`, `GET /v1/links`, `GET /v1/links/{id}`, `PATCH /v1/links/{id}`, `POST /v1/links/{id}/disable`, `POST /v1/properties`, `POST /v1/properties/{id}/submit`, `POST /v1/api-keys`.
- **Scenario references:** `UC11`, `UC32`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-033 — Link detail.

- **Suggested navigation alias (optional):** `/links/[id]`
- **User goal:** Link detail.
- **Controls / submitted values:** disable action, expires_at optional.
- **Required visible states:** route eligibility, click summary, copy, revocation confirmation.
- **Related operation examples:** `POST /v1/links`, `GET /v1/links`, `GET /v1/links/{id}`, `PATCH /v1/links/{id}`, `POST /v1/links/{id}/disable`.
- **Scenario references:** `UC11`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-034 — CSV link generator.

- **Suggested navigation alias (optional):** `/links/import`
- **User goal:** CSV link generator.
- **Controls / submitted values:** upload_ref, property_id, column mapping.
- **Required visible states:** upload -> asynchronous pending for delivery -> progress -> result, per-row failures downloadable.
- **Related operation examples:** `POST /v1/links/bulk`, `GET /v1/links/bulk/{id}`, `GET /v1/reports/exports/{id}`.
- **Scenario references:** `UC12`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-035 — Bulk import detail.

- **Suggested navigation alias (optional):** `/links/import/[jobId]`
- **User goal:** Bulk import detail.
- **Controls / submitted values:** job ID and export actions.
- **Required visible states:** asynchronous pending for delivery/running/done/partial/failed, safe CSV download.
- **Related operation examples:** `POST /v1/links/bulk`, `GET /v1/links/bulk/{id}`, `GET /v1/reports/exports/{id}`.
- **Scenario references:** `UC12`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-036 — Public redirect-only endpoint served by Go.

- **Suggested navigation alias (optional):** `/r/[token] (visitor redirect experience)`
- **User goal:** Public redirect-only endpoint served by Go.
- **Controls / submitted values:** opaque link token only; no dashboard page or form.
- **Required visible states:** 302 approved network URL; 410 revoked/unknown; 503 safely unavailable.
- **Related operation examples:** `GET /r/{token}`, `POST /internal/v1/events/click`.
- **Scenario references:** `UC13`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-037 — Click analytics.

- **Suggested navigation alias (optional):** `/reports/clicks`
- **User goal:** Click analytics.
- **Controls / submitted values:** date range, group interval, property.
- **Required visible states:** raw vs qualified, source freshness; empty vs stale vs unavailable.
- **Related operation examples:** `POST /internal/v1/events/click`, `GET /v1/reports/clicks`, `GET /v1/reports/conversions`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`.
- **Scenario references:** `UC14`, `UC23`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-038 — Queue health and dead letters.

- **Suggested navigation alias (optional):** `/admin/operations/queues`
- **User goal:** Queue health and dead letters.
- **Controls / submitted values:** asynchronous delivery workflow, failure ID.
- **Required visible states:** dry-run and controlled replay.
- **Related operation examples:** `POST /internal/v1/events/click`, `GET /v1/reports/clicks`, `GET /v1/admin/integrations`, `GET /v1/admin/audit-logs`, `POST /internal/v1/jobs/replay`, `GET /internal/health/ready`.
- **Scenario references:** `UC14`, `UC29`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-039 — Upstream report import list.

- **Suggested navigation alias (optional):** `/admin/integrations/[id]/imports`
- **User goal:** Upstream report import list.
- **Controls / submitted values:** period, import state.
- **Required visible states:** digest, parser version, matched/unmatched count.
- **Related operation examples:** `POST /v1/admin/integrations/{id}/sync`, `GET /v1/admin/conversions/exceptions`, `GET /v1/reports/conversions`.
- **Scenario references:** `UC15`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-040 — Unmatched attribution and conversion exceptions.

- **Suggested navigation alias (optional):** `/admin/conversions/exceptions`
- **User goal:** Unmatched attribution and conversion exceptions.
- **Controls / submitted values:** network, reason, age.
- **Required visible states:** resolve with evidence and only permitted manual mapping.
- **Related operation examples:** `POST /v1/admin/integrations/{id}/sync`, `GET /v1/admin/conversions/exceptions`, `GET /v1/reports/conversions`, `GET /v1/reports/earnings`.
- **Scenario references:** `UC15`, `UC16`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-041 — Partner-reported conversions.

- **Suggested navigation alias (optional):** `/reports/conversions`
- **User goal:** Partner-reported conversions.
- **Controls / submitted values:** date range, property, status.
- **Required visible states:** tracked/pending/approved/reversed with reported-at and source.
- **Related operation examples:** `POST /v1/admin/integrations/{id}/sync`, `GET /v1/admin/conversions/exceptions`, `GET /v1/reports/conversions`, `GET /v1/reports/clicks`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`.
- **Scenario references:** `UC15`, `UC23`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-042 — Publisher financial reporting.

- **Suggested navigation alias (optional):** `/reports/earnings`
- **User goal:** Publisher financial reporting.
- **Controls / submitted values:** period, currency, property.
- **Required visible states:** separate pending/approved/cleared/payable/paid and adjustment rows.
- **Related operation examples:** `GET /v1/reports/earnings`, `GET /v1/admin/conversions/exceptions`, `GET /v1/statements`, `GET /v1/statements/{id}/download`, `POST /v1/reports/exports`, `GET /v1/reports/clicks`, `GET /v1/reports/conversions`.
- **Scenario references:** `UC16`, `UC20`, `UC23`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-043 — Statements history.

- **Suggested navigation alias (optional):** `/finance/statements`
- **User goal:** Statements history.
- **Controls / submitted values:** period and currency filters.
- **Required visible states:** revisions, authoritative totals, secure export.
- **Related operation examples:** `GET /v1/reports/earnings`, `GET /v1/admin/conversions/exceptions`, `GET /v1/statements`, `GET /v1/statements/{id}/download`, `POST /v1/reports/exports`.
- **Scenario references:** `UC16`, `UC20`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-044 — Settlement reconciliation.

- **Suggested navigation alias (optional):** `/admin/settlements`
- **User goal:** Settlement reconciliation.
- **Controls / submitted values:** network,currency,period.
- **Required visible states:** receipts -> allocations -> exceptions; cannot clear unmatched.
- **Related operation examples:** `POST /v1/admin/settlements/import`, `GET /v1/admin/settlements`, `GET /v1/balances`.
- **Scenario references:** `UC17`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-045 — Import settlement statement.

- **Suggested navigation alias (optional):** `/admin/settlements/import`
- **User goal:** Import settlement statement.
- **Controls / submitted values:** network, object_ref, digest.
- **Required visible states:** preview validations, import progress, exceptions.
- **Related operation examples:** `POST /v1/admin/settlements/import`, `GET /v1/admin/settlements`, `GET /v1/balances`.
- **Scenario references:** `UC17`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-046 — Settled balances and holds.

- **Suggested navigation alias (optional):** `/finance/balance`
- **User goal:** Settled balances and holds.
- **Controls / submitted values:** currency selector.
- **Required visible states:** pending is not withdrawable; show available, held, inflight and threshold.
- **Related operation examples:** `POST /v1/admin/settlements/import`, `GET /v1/admin/settlements`, `GET /v1/balances`, `GET /v1/payout-methods`, `POST /v1/payout-methods`, `DELETE /v1/payout-methods/{id}`.
- **Scenario references:** `UC17`, `UC18`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-047 — Payout method management.

- **Suggested navigation alias (optional):** `/finance/payout-methods`
- **User goal:** Payout method management.
- **Controls / submitted values:** provider, country, currency.
- **Required visible states:** pending/verified/disabled, safe delete rules.
- **Related operation examples:** `GET /v1/payout-methods`, `POST /v1/payout-methods`, `DELETE /v1/payout-methods/{id}`.
- **Scenario references:** `UC18`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-048 — Provider-hosted payout enrollment.

- **Suggested navigation alias (optional):** `/finance/payout-methods/new`
- **User goal:** Provider-hosted payout enrollment.
- **Controls / submitted values:** country,currency,provider.
- **Required visible states:** redirect/tokenize hosted form; platform never collects bank credentials.
- **Related operation examples:** `GET /v1/payout-methods`, `POST /v1/payout-methods`, `DELETE /v1/payout-methods/{id}`.
- **Scenario references:** `UC18`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-049 — Finance maker/checker overview.

- **Suggested navigation alias (optional):** `/admin/payout-batches`
- **User goal:** Finance maker/checker overview.
- **Controls / submitted values:** period, currency, state.
- **Required visible states:** prepare, approve/release only for separate MFA user.
- **Related operation examples:** `POST /v1/admin/payout-batches`, `POST /v1/admin/payout-batches/{id}/approve`, `POST /v1/admin/payout-batches/{id}/release`, `GET /v1/payouts`.
- **Scenario references:** `UC19`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-050 — Prepare payout batch.

- **Suggested navigation alias (optional):** `/admin/payout-batches/new`
- **User goal:** Prepare payout batch.
- **Controls / submitted values:** period, currency.
- **Required visible states:** settled available validation, locked reservations and threshold check.
- **Related operation examples:** `POST /v1/admin/payout-batches`, `POST /v1/admin/payout-batches/{id}/approve`, `POST /v1/admin/payout-batches/{id}/release`, `GET /v1/payouts`.
- **Scenario references:** `UC19`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-051 — Approve or release payout batch.

- **Suggested navigation alias (optional):** `/admin/payout-batches/[id]`
- **User goal:** Approve or release payout batch.
- **Controls / submitted values:** approval reason.
- **Required visible states:** maker blocked from own approval, audit timeline and provider state.
- **Related operation examples:** `POST /v1/admin/payout-batches`, `POST /v1/admin/payout-batches/{id}/approve`, `POST /v1/admin/payout-batches/{id}/release`, `GET /v1/payouts`.
- **Scenario references:** `UC19`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-052 — Publisher payout history.

- **Suggested navigation alias (optional):** `/finance/payouts`
- **User goal:** Publisher payout history.
- **Controls / submitted values:** status, currency, date range.
- **Required visible states:** payout requested, processing, paid/failed; provider receipt.
- **Related operation examples:** `POST /v1/admin/payout-batches`, `POST /v1/admin/payout-batches/{id}/approve`, `POST /v1/admin/payout-batches/{id}/release`, `GET /v1/payouts`.
- **Scenario references:** `UC19`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-053 — Statement detail.

- **Suggested navigation alias (optional):** `/finance/statements/[id]`
- **User goal:** Statement detail.
- **Controls / submitted values:** none.
- **Required visible states:** line-item gross/platform/publisher/adjustments and receipt link.
- **Related operation examples:** `GET /v1/statements`, `GET /v1/statements/{id}/download`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`.
- **Scenario references:** `UC20`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-054 — API key inventory.

- **Suggested navigation alias (optional):** `/developers/api-keys`
- **User goal:** API key inventory.
- **Controls / submitted values:** scope/property filters.
- **Required visible states:** show prefix only; rotate/revoke, never fetch old secret.
- **Related operation examples:** `GET /v1/api-keys`, `POST /v1/api-keys`, `POST /v1/api-keys/{id}/rotate`, `DELETE /v1/api-keys/{id}`, `POST /v1/properties`, `POST /v1/properties/{id}/submit`, `POST /v1/links`.
- **Scenario references:** `UC21`, `UC32`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-055 — Create scoped API key.

- **Suggested navigation alias (optional):** `/developers/api-keys/new`
- **User goal:** Create scoped API key.
- **Controls / submitted values:** name, expiry, scopes, property_id.
- **Required visible states:** confirm scopes, creation displays secret once.
- **Related operation examples:** `GET /v1/api-keys`, `POST /v1/api-keys`, `POST /v1/api-keys/{id}/rotate`, `DELETE /v1/api-keys/{id}`.
- **Scenario references:** `UC21`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-056 — Key detail and rotation.

- **Suggested navigation alias (optional):** `/developers/api-keys/[id]`
- **User goal:** Key detail and rotation.
- **Controls / submitted values:** scope, revoke, rotate.
- **Required visible states:** rotation overlap countdown, audit history.
- **Related operation examples:** `GET /v1/api-keys`, `POST /v1/api-keys`, `POST /v1/api-keys/{id}/rotate`, `DELETE /v1/api-keys/{id}`.
- **Scenario references:** `UC21`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-057 — Webhook endpoint inventory.

- **Suggested navigation alias (optional):** `/developers/webhooks`
- **User goal:** Webhook endpoint inventory.
- **Controls / submitted values:** event type filter.
- **Required visible states:** verified/pending/disabled, recent failure count.
- **Related operation examples:** `POST /v1/webhooks`, `PATCH /v1/webhooks/{id}`, `GET /v1/webhooks/{id}/deliveries`, `POST /v1/webhooks/{id}/test`, `POST /v1/webhooks/{id}/rotate-secret`.
- **Scenario references:** `UC22`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-058 — Create signed webhook.

- **Suggested navigation alias (optional):** `/developers/webhooks/new`
- **User goal:** Create signed webhook.
- **Controls / submitted values:** HTTPS URL, event selection.
- **Required visible states:** show secret once, send test, activation confirmation.
- **Related operation examples:** `POST /v1/webhooks`, `PATCH /v1/webhooks/{id}`, `GET /v1/webhooks/{id}/deliveries`, `POST /v1/webhooks/{id}/test`, `POST /v1/webhooks/{id}/rotate-secret`.
- **Scenario references:** `UC22`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-059 — Webhook delivery inspection.

- **Suggested navigation alias (optional):** `/developers/webhooks/[id]/deliveries`
- **User goal:** Webhook delivery inspection.
- **Controls / submitted values:** time/status filters, retry action.
- **Required visible states:** redacted payload, signature metadata, attempts timeline.
- **Related operation examples:** `POST /v1/webhooks`, `PATCH /v1/webhooks/{id}`, `GET /v1/webhooks/{id}/deliveries`, `POST /v1/webhooks/{id}/test`, `POST /v1/webhooks/{id}/rotate-secret`.
- **Scenario references:** `UC22`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-060 — Asynchronous export center.

- **Suggested navigation alias (optional):** `/reports/exports`
- **User goal:** Asynchronous export center.
- **Controls / submitted values:** type, period, filters.
- **Required visible states:** asynchronous pending for delivery/running/ready/failed; signed short-lived download.
- **Related operation examples:** `GET /v1/reports/clicks`, `GET /v1/reports/conversions`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`.
- **Scenario references:** `UC23`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-061 — Abuse detection queue.

- **Suggested navigation alias (optional):** `/admin/risk`
- **User goal:** Abuse detection queue.
- **Controls / submitted values:** severity, state, publisher.
- **Required visible states:** review flagged evidence, suspend/clear, no silent earnings deletion.
- **Related operation examples:** `GET /v1/admin/risk-flags`, `POST /v1/admin/risk-flags/{id}/decision`, `POST /v1/admin/kill-switch`.
- **Scenario references:** `UC24`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-062 — Individual abuse investigation.

- **Suggested navigation alias (optional):** `/admin/risk/[id]`
- **User goal:** Individual abuse investigation.
- **Controls / submitted values:** risk decision and evidence.
- **Required visible states:** resolve/appeal, route invalidation preview.
- **Related operation examples:** `GET /v1/admin/risk-flags`, `POST /v1/admin/risk-flags/{id}/decision`, `POST /v1/admin/kill-switch`.
- **Scenario references:** `UC24`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-063 — Publisher risk appeal submission.

- **Suggested navigation alias (optional):** `/settings/compliance/appeals`
- **User goal:** Publisher risk appeal submission.
- **Controls / submitted values:** flag_id, statement, evidence_ref.
- **Required visible states:** request accepted and resolution timeline.
- **Related operation examples:** `GET /v1/admin/risk-flags`, `POST /v1/admin/risk-flags/{id}/decision`, `POST /v1/admin/kill-switch`.
- **Scenario references:** `UC24`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-064 — Consent/privacy preferences.

- **Suggested navigation alias (optional):** `/settings/privacy`
- **User goal:** Consent/privacy preferences.
- **Controls / submitted values:** CMP integration mode and data request.
- **Required visible states:** opt-in/out state and privacy rights links.
- **Related operation examples:** `GET /v1/admin/privacy-requests`, `POST /v1/admin/privacy-requests/{id}/resolve`.
- **Scenario references:** `UC25`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-065 — Privacy operations queue.

- **Suggested navigation alias (optional):** `/admin/privacy-requests`
- **User goal:** Privacy operations queue.
- **Controls / submitted values:** type, status, due date.
- **Required visible states:** identity proof, export/erase progress, hold and evidence.
- **Related operation examples:** `GET /v1/admin/privacy-requests`, `POST /v1/admin/privacy-requests/{id}/resolve`.
- **Scenario references:** `UC25`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-066 — Publisher compliance status.

- **Suggested navigation alias (optional):** `/settings/compliance`
- **User goal:** Publisher compliance status.
- **Controls / submitted values:** KYB status, risk notification preferences.
- **Required visible states:** pending/rejected/approved evidence and support actions.
- **Related operation examples:** `GET /v1/admin/privacy-requests`, `POST /v1/admin/privacy-requests/{id}/resolve`.
- **Scenario references:** `UC25`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-067 — Optimize overview.

- **Suggested navigation alias (optional):** `/optimize`
- **User goal:** Optimize overview.
- **Controls / submitted values:** property chooser.
- **Required visible states:** enable/disable, linked configuration pages.
- **Related operation examples:** `POST /v1/optimize/installations`, `GET /v1/optimize/config/{public_key}`, `POST /v1/optimize/resolve-batch`, `POST /v1/optimize/installations/{id}/disable`.
- **Scenario references:** `UC26`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-068 — Script deployment wizard.

- **Suggested navigation alias (optional):** `/optimize/install`
- **User goal:** Script deployment wizard.
- **Controls / submitted values:** allowed_origins, property_id.
- **Required visible states:** copy snippet, CSP, preview and verification.
- **Related operation examples:** `POST /v1/optimize/installations`, `GET /v1/optimize/config/{public_key}`, `POST /v1/optimize/resolve-batch`, `POST /v1/optimize/installations/{id}/disable`.
- **Scenario references:** `UC26`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-069 — Monetization rules editor.

- **Suggested navigation alias (optional):** `/optimize/rules`
- **User goal:** Monetization rules editor.
- **Controls / submitted values:** selectors, merchant blocks, action, policy version.
- **Required visible states:** preview, optimistic concurrency, deny-first.
- **Related operation examples:** `POST /v1/optimize/installations`, `GET /v1/optimize/config/{public_key}`, `POST /v1/optimize/resolve-batch`, `POST /v1/optimize/installations/{id}/disable`, `GET /v1/optimize/rules`, `PUT /v1/optimize/rules`.
- **Scenario references:** `UC26`, `UC27`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-070 — Property JS integration health.

- **Suggested navigation alias (optional):** `/properties/[id]/integration`
- **User goal:** Property JS integration health.
- **Controls / submitted values:** origin, integration package state.
- **Required visible states:** script snippet, disabled origin error, consent status.
- **Related operation examples:** `POST /v1/optimize/installations`, `GET /v1/optimize/config/{public_key}`, `POST /v1/optimize/resolve-batch`, `POST /v1/optimize/installations/{id}/disable`, `GET /v1/optimize/rules`, `PUT /v1/optimize/rules`.
- **Scenario references:** `UC26`, `UC27`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-071 — CMP consent settings.

- **Suggested navigation alias (optional):** `/optimize/consent`
- **User goal:** CMP consent settings.
- **Controls / submitted values:** CMP provider, mode, version.
- **Required visible states:** strict mode, live preview, restore on revoke.
- **Related operation examples:** `GET /v1/optimize/rules`, `PUT /v1/optimize/rules`, `GET /v1/optimize/config/{public_key}`.
- **Scenario references:** `UC27`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-072 — Route experiments.

- **Suggested navigation alias (optional):** `/optimize/experiments`
- **User goal:** Route experiments.
- **Controls / submitted values:** property, holdout percentage.
- **Required visible states:** authorized experiment create, srecord treatment.
- **Related operation examples:** `POST /v1/optimize/experiments`, `GET /v1/optimize/decisions`, `POST /v1/optimize/resolve-batch`.
- **Scenario references:** `UC28`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-073 — Experiment health.

- **Suggested navigation alias (optional):** `/optimize/experiments/[id]`
- **User goal:** Experiment health.
- **Controls / submitted values:** sample sizes, event windows.
- **Required visible states:** confidence warning, stop/rollback.
- **Related operation examples:** `POST /v1/optimize/experiments`, `GET /v1/optimize/decisions`, `POST /v1/optimize/resolve-batch`.
- **Scenario references:** `UC28`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-074 — Explainable link decisions.

- **Suggested navigation alias (optional):** `/optimize/decisions`
- **User goal:** Explainable link decisions.
- **Controls / submitted values:** merchant, property, reason filter.
- **Required visible states:** display route reason/policy/model version.
- **Related operation examples:** `POST /v1/optimize/experiments`, `GET /v1/optimize/decisions`, `POST /v1/optimize/resolve-batch`.
- **Scenario references:** `UC28`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-075 — Operational health.

- **Suggested navigation alias (optional):** `/admin/operations`
- **User goal:** Operational health.
- **Controls / submitted values:** time range, service.
- **Required visible states:** SLO, alert, incident, trace search.
- **Related operation examples:** `GET /v1/admin/integrations`, `GET /v1/admin/audit-logs`, `POST /internal/v1/jobs/replay`, `GET /internal/health/ready`.
- **Scenario references:** `UC29`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-076 — Adapter monitoring.

- **Suggested navigation alias (optional):** `/admin/operations/network-health`
- **User goal:** Adapter monitoring.
- **Controls / submitted values:** network, resource, health.
- **Required visible states:** success lag, 429, schema drift.
- **Related operation examples:** `GET /v1/admin/integrations`, `GET /v1/admin/audit-logs`, `POST /internal/v1/jobs/replay`, `GET /internal/health/ready`.
- **Scenario references:** `UC29`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-077 — Tamper-evident audit viewer.

- **Suggested navigation alias (optional):** `/admin/audit`
- **User goal:** Tamper-evident audit viewer.
- **Controls / submitted values:** entity, actor, time.
- **Required visible states:** redacted records; auditor-only access.
- **Related operation examples:** `GET /v1/admin/integrations`, `GET /v1/admin/audit-logs`, `POST /internal/v1/jobs/replay`, `GET /internal/health/ready`.
- **Scenario references:** `UC29`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-078 — Geographic rollout gates.

- **Suggested navigation alias (optional):** `/admin/launch`
- **User goal:** Geographic rollout gates.
- **Controls / submitted values:** country, network, channel.
- **Required visible states:** legal+commercial+payout evidence, MFA approval, kill switch.
- **Related operation examples:** `POST /v1/admin/kill-switch`, `GET /v1/admin/integrations`, `GET /internal/health/ready`.
- **Scenario references:** `UC30`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-079 — Future licensed feed status.

- **Suggested navigation alias (optional):** `/commerce/feeds`
- **User goal:** Future licensed feed status.
- **Controls / submitted values:** feed source.
- **Required visible states:** research-only until approved.
- **Related operation examples:** `GET /v1/programs`, `GET /v1/advertisers`.
- **Scenario references:** `UC31`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-080 — Future coupon overview.

- **Suggested navigation alias (optional):** `/commerce/coupons`
- **User goal:** Future coupon overview.
- **Controls / submitted values:** merchant, expiry.
- **Required visible states:** never publish unlicensed/expired coupons.
- **Related operation examples:** `GET /v1/programs`, `GET /v1/advertisers`.
- **Scenario references:** `UC31`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

### UI-081 — Future product catalog.

- **Suggested navigation alias (optional):** `/commerce/products`
- **User goal:** Future product catalog.
- **Controls / submitted values:** merchant, category.
- **Required visible states:** rights and freshness enforced.
- **Related operation examples:** `GET /v1/programs`, `GET /v1/advertisers`.
- **Scenario references:** `UC31`.
- **Acceptance:** A user with required permission can reach and complete the experience, with explicit loading/error/success states; an unauthorized or suspended user cannot access protected data; retry and direct navigation preserve correctness; input remains accessible and responsive.

## High-security user experience: password recovery

1. **Request recovery:** visible entry screen with identity field, submit action, generic confirmation; both existing and unknown identities look the same.
2. **Delivery handoff:** user receives a short-lived recovery link or equivalent verified recovery method; invalid/expired proof has a dedicated safe path back to request recovery.
3. **Set new secret:** two UI fields for new password and confirmation, disclosure of password policy, accessible validation feedback, submit disabled while processing; temporary proof never passed to unrelated analytics or third-party scripts.
4. **Success:** confirmed result routes to fresh login; it does not silently reauthenticate or bypass MFA.
5. **Failure:** weak password, mismatch, token used/expired, submission race, suspended account policy, and delivery outage have distinct safe recoverable experiences.
6. **QA:** navigate from login through recovery end to end, refresh each screen, verify no credential appears in logs or third-party calls, and verify prior sessions cannot continue.

## High-security user experience: finance and payouts

The finance screen must visually distinguish estimated, approved, settled, available, held, reserved and paid funds; show each money amount in its original currency; reveal reconciliation exceptions separately; prohibit a finance user from self-approving where dual control is required; and show outcome-unknown transfers without allowing a second payment.
