# Moneytrap — Technology-Neutral API Operation Catalog

**Contract is the operation, not the route.** Each API entry preserves a suggested HTTP binding from the legacy technical blueprint to help transition, but clients may use equivalent RPC, local application functions, messages, or future transports. HTTP status codes are illustrative mappings. The binding is not a requirement to use a particular server framework or network topology.

A conforming operation defines: principal and scope, preconditions, required inputs, outputs, domain error classes, side effects, idempotency/replay semantics, and observable consistency. A UI must not depend on an undocumented implementation-only property.

## Common operation contract

- All protected reads and writes enforce organization, publisher and property scope.
- Commands validate inputs at the authoritative boundary; interface validation is advisory.
- Retries of the same logical command must be safe; conditional state transitions reject stale revisions.
- A successful response may be immediate or accepted/pending where the operation is intentionally asynchronous. Declare which.
- Read operations return a freshness marker where results are delayed or based on upstream data.
- Filtered collections provide deterministic order, bounded pagination, and opaque continuation.
- Errors use stable semantic codes independently of transport-specific status codes.
- For any mutation involving finances, permissions, credentials, approvals or compliance, record actor, effective policy and audit evidence.
- Provider-specific source operations must validate signature or equivalent authenticity and cannot create permissions merely because a provider sent a new value.

## Logical operations

### API-001 — Register identity

- **Suggested binding (optional):** `POST /v1/auth/register`
- **Capability:** `auth`; **caller/security scope:** `public`.
- **Input contract:** `{email,password,display_name,locale,accept_terms_version}`
- **Outcome contract:** `202 {message: "Check email"}`
- **Logical entities touched:** `users`, `email_verification_tokens`, `notification_deliveries`.
- **Expected domain event:** `user.registered`
- **Legacy transport error mapping (illustrative):** `400,409,422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Normalize the email consistently and protect the password with approved credential hashing; no token in application logs; account activation email verification required.

### API-002 — Verify email

- **Suggested binding (optional):** `POST /v1/auth/verify-email`
- **Capability:** `auth`; **caller/security scope:** `public`.
- **Input contract:** `{token}`
- **Outcome contract:** `200 {verified:true}`
- **Logical entities touched:** `users`, `email_verification_tokens`, `audit_logs`.
- **Expected domain event:** `user.email_verified`
- **Legacy transport error mapping (illustrative):** `400,410,422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Single-use hash compare, update verified_at transactionally, replay returns 410.

### API-003 — Resend verification

- **Suggested binding (optional):** `POST /v1/auth/resend-verification`
- **Capability:** `auth`; **caller/security scope:** `public`.
- **Input contract:** `{email}`
- **Outcome contract:** `202 {message: "If eligible, email sent"}`
- **Logical entities touched:** `users`, `email_verification_tokens`, `notification_deliveries`.
- **Expected domain event:** `email.verification_requested`
- **Legacy transport error mapping (illustrative):** `422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Non-enumerating result, cooldown per IP/email.

### API-004 — Authenticate

- **Suggested binding (optional):** `POST /v1/auth/login`
- **Capability:** `auth`; **caller/security scope:** `public`.
- **Input contract:** `{email,password}`
- **Outcome contract:** `200 {session?,mfa_required?,challenge_id?}`
- **Logical entities touched:** `users`, `auth_sessions`, `mfa_factors`.
- **Expected domain event:** `user.login_attempted`
- **Legacy transport error mapping (illustrative):** `400,401,423,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Verify password using approved credential hashing; generic bad credentials; MFA challenge for privileged accounts; if a browser cookie session is used, enforce secure cookie attributes and request-forgery protection.

### API-005 — Complete MFA challenge

- **Suggested binding (optional):** `POST /v1/auth/mfa/challenge`
- **Capability:** `auth`; **caller/security scope:** `user:mfa-pending`.
- **Input contract:** `{challenge_id,otp_or_webauthn_response}`
- **Outcome contract:** `200 {authenticated:true}`
- **Logical entities touched:** `mfa_factors`, `auth_sessions`, `audit_logs`.
- **Expected domain event:** `user.mfa_completed`
- **Legacy transport error mapping (illustrative):** `401,403,410,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-006 — Log out

- **Suggested binding (optional):** `POST /v1/auth/logout`
- **Capability:** `auth`; **caller/security scope:** `session`.
- **Input contract:** `{}`
- **Outcome contract:** `204`
- **Logical entities touched:** `auth_sessions`.
- **Expected domain event:** `user.session_revoked`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-007 — Read current identity

- **Suggested binding (optional):** `GET /v1/auth/me`
- **Capability:** `auth`; **caller/security scope:** `session`.
- **Input contract:** `none`
- **Outcome contract:** `200 {id,email,memberships,capabilities}`
- **Logical entities touched:** `users`, `memberships`, `organizations`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-008 — Request password recovery

- **Suggested binding (optional):** `POST /v1/auth/forgot-password`
- **Capability:** `auth`; **caller/security scope:** `public`.
- **Input contract:** `{email}`
- **Outcome contract:** `202 {message:"If account exists, instructions sent"}`
- **Logical entities touched:** `users`, `password_reset_tokens`, `notification_deliveries`, `audit_logs`.
- **Expected domain event:** `auth.password_reset_requested`
- **Legacy transport error mapping (illustrative):** `422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Constant-shape response, reset token hash configured expiration, asynchronous delivery mechanism email with provider dedup; rate limit by IP and normalized email.

### API-009 — Complete password recovery

- **Suggested binding (optional):** `POST /v1/auth/reset-password`
- **Capability:** `auth`; **caller/security scope:** `public`.
- **Input contract:** `{email,token,new_password,new_password_confirmation}`
- **Outcome contract:** `204`
- **Logical entities touched:** `users`, `password_reset_tokens`, `auth_sessions`, `audit_logs`.
- **Expected domain event:** `auth.password_reset_completed`
- **Legacy transport error mapping (illustrative):** `400,410,422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Transaction atomically claims the recovery challenge; verify hash/age; password an approved password hashing scheme; token one-time delete; bump auth_version and revoke existing sessions; do NOT skip MFA or auto-login.

### API-010 — Change password

- **Suggested binding (optional):** `PUT /v1/auth/password`
- **Capability:** `auth`; **caller/security scope:** `session:reauth`.
- **Input contract:** `{current_password,new_password,new_password_confirmation}`
- **Outcome contract:** `204`
- **Logical entities touched:** `users`, `auth_sessions`, `audit_logs`.
- **Expected domain event:** `auth.password_changed`
- **Legacy transport error mapping (illustrative):** `401,403,422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-011 — List active sessions

- **Suggested binding (optional):** `GET /v1/auth/sessions`
- **Capability:** `auth`; **caller/security scope:** `session`.
- **Input contract:** `none`
- **Outcome contract:** `200 {data:[{id,device_label,created_at,expires_at}]}`
- **Logical entities touched:** `auth_sessions`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-012 — Revoke active session

- **Suggested binding (optional):** `DELETE /v1/auth/sessions/{session_id}`
- **Capability:** `auth`; **caller/security scope:** `session`.
- **Input contract:** `none`
- **Outcome contract:** `204`
- **Logical entities touched:** `auth_sessions`, `audit_logs`.
- **Expected domain event:** `user.session_revoked`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-013 — Begin MFA enrollment

- **Suggested binding (optional):** `POST /v1/auth/mfa/enroll`
- **Capability:** `auth`; **caller/security scope:** `session:reauth`.
- **Input contract:** `{type}`
- **Outcome contract:** `200 {challenge_or_registration_options}`
- **Logical entities touched:** `mfa_factors`, `audit_logs`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-014 — Confirm MFA enrollment

- **Suggested binding (optional):** `POST /v1/auth/mfa/confirm`
- **Capability:** `auth`; **caller/security scope:** `session:reauth`.
- **Input contract:** `{factor_id,proof}`
- **Outcome contract:** `200 {recovery_codes_once}`
- **Logical entities touched:** `mfa_factors`, `audit_logs`.
- **Expected domain event:** `user.mfa_enabled`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-015 — Create organization

- **Suggested binding (optional):** `POST /v1/organizations`
- **Capability:** `org`; **caller/security scope:** `session`.
- **Input contract:** `{name,country,base_currency}`
- **Outcome contract:** `201 {id,status}`
- **Logical entities touched:** `organizations`, `memberships`, `publishers`, `audit_logs`.
- **Expected domain event:** `organization.created`
- **Legacy transport error mapping (illustrative):** `401,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-016 — Read organization

- **Suggested binding (optional):** `GET /v1/organizations/current`
- **Capability:** `org`; **caller/security scope:** `session:member`.
- **Input contract:** `none`
- **Outcome contract:** `200 {organization,publisher,roles}`
- **Logical entities touched:** `organizations`, `memberships`, `publishers`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-017 — Update current (organizations)

- **Suggested binding (optional):** `PATCH /v1/organizations/current`
- **Capability:** `org`; **caller/security scope:** `session:owner`.
- **Input contract:** `{name,legal_name?,base_currency?}`
- **Outcome contract:** `200 {organization}`
- **Logical entities touched:** `organizations`, `audit_logs`.
- **Expected domain event:** `organization.updated`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-018 — List/read members (members)

- **Suggested binding (optional):** `GET /v1/members`
- **Capability:** `org`; **caller/security scope:** `session:member`.
- **Input contract:** `none`
- **Outcome contract:** `200 {data:[member]}`
- **Logical entities touched:** `memberships`, `users`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-019 — Create/execute invitations (invitations)

- **Suggested binding (optional):** `POST /v1/invitations`
- **Capability:** `org`; **caller/security scope:** `session:owner`.
- **Input contract:** `{email,role}`
- **Outcome contract:** `201 {id,expires_at}`
- **Logical entities touched:** `organization_invites`, `notification_deliveries`, `audit_logs`.
- **Expected domain event:** `membership.invited`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-020 — Create/execute accept (invitations)

- **Suggested binding (optional):** `POST /v1/invitations/accept`
- **Capability:** `org`; **caller/security scope:** `session`.
- **Input contract:** `{token}`
- **Outcome contract:** `200 {organization_id}`
- **Logical entities touched:** `organization_invites`, `memberships`, `audit_logs`.
- **Expected domain event:** `membership.joined`
- **Legacy transport error mapping (illustrative):** `401,404,410,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-021 — Revoke/remove members resource

- **Suggested binding (optional):** `DELETE /v1/members/{member_id}`
- **Capability:** `org`; **caller/security scope:** `session:owner`.
- **Input contract:** `none`
- **Outcome contract:** `204`
- **Logical entities touched:** `memberships`, `auth_sessions`, `audit_logs`.
- **Expected domain event:** `membership.removed`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Cannot remove last owner. Revoke access/sessions and API keys under affected scopes.

### API-022 — Submit publisher for review

- **Suggested binding (optional):** `POST /v1/publishers/submit`
- **Capability:** `publisher`; **caller/security scope:** `session:owner`.
- **Input contract:** `{entity_type,company_reference?}`
- **Outcome contract:** `202 {status:"in_review"}`
- **Logical entities touched:** `publishers`, `publisher_kyb`, `audit_logs`.
- **Expected domain event:** `publisher.submitted`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-023 — Read publisher review status

- **Suggested binding (optional):** `GET /v1/publishers/status`
- **Capability:** `publisher`; **caller/security scope:** `session:member`.
- **Input contract:** `none`
- **Outcome contract:** `200 {status,review_reason?}`
- **Logical entities touched:** `publishers`, `publisher_kyb`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-024 — Create/execute properties (properties)

- **Suggested binding (optional):** `POST /v1/properties`
- **Capability:** `publisher`; **caller/security scope:** `properties:write`.
- **Input contract:** `{type,identifier,country,channel}`
- **Outcome contract:** `201 {id,status,verification_methods}`
- **Logical entities touched:** `properties`, `property_verifications`, `audit_logs`.
- **Expected domain event:** `property.created`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-025 — List/read properties (properties)

- **Suggested binding (optional):** `GET /v1/properties`
- **Capability:** `publisher`; **caller/security scope:** `properties:read`.
- **Input contract:** `page[size],page[after]`
- **Outcome contract:** `200 {data,meta:{next_cursor}}`
- **Logical entities touched:** `properties`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-026 — List/read properties resource

- **Suggested binding (optional):** `GET /v1/properties/{id}`
- **Capability:** `publisher`; **caller/security scope:** `properties:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {property,verification}`
- **Logical entities touched:** `properties`, `property_verifications`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-027 — Create/execute verification challenge (properties)

- **Suggested binding (optional):** `POST /v1/properties/{id}/verification-challenge`
- **Capability:** `publisher`; **caller/security scope:** `properties:write`.
- **Input contract:** `{method:"dns"|"html"|"meta"|"manual"}`
- **Outcome contract:** `201 {challenge_text,expires_at}`
- **Logical entities touched:** `property_verifications`, `audit_logs`.
- **Expected domain event:** `property.verification_challenged`
- **Legacy transport error mapping (illustrative):** `401,403,404,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-028 — Create/execute verify (properties)

- **Suggested binding (optional):** `POST /v1/properties/{id}/verify`
- **Capability:** `publisher`; **caller/security scope:** `properties:write`.
- **Input contract:** `{challenge_id}`
- **Outcome contract:** `200 {verification_status}`
- **Logical entities touched:** `property_verifications`, `properties`, `audit_logs`.
- **Expected domain event:** `property.verified`
- **Legacy transport error mapping (illustrative):** `401,403,404,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. DNS TXT/HTTPS meta fetch initial page renderingF-safe; manual social/app review. Verification != approval.

### API-029 — Create/execute submit (properties)

- **Suggested binding (optional):** `POST /v1/properties/{id}/submit`
- **Capability:** `publisher`; **caller/security scope:** `properties:write`.
- **Input contract:** `{}`
- **Outcome contract:** `202 {approval_status:"in_review"}`
- **Logical entities touched:** `properties`, `property_approval_reviews`, `audit_logs`.
- **Expected domain event:** `property.review_requested`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-030 — Update properties resource

- **Suggested binding (optional):** `PATCH /v1/properties/{id}`
- **Capability:** `publisher`; **caller/security scope:** `properties:write`.
- **Input contract:** `{label?,country?}`
- **Outcome contract:** `200 {property}`
- **Logical entities touched:** `properties`, `audit_logs`.
- **Expected domain event:** `property.updated`
- **Legacy transport error mapping (illustrative):** `401,403,404,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-031 — Create/execute disable (properties)

- **Suggested binding (optional):** `POST /v1/properties/{id}/disable`
- **Capability:** `publisher`; **caller/security scope:** `properties:write`.
- **Input contract:** `{reason}`
- **Outcome contract:** `202 {status:"suspended"}`
- **Logical entities touched:** `properties`, `link_routes`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `property.disabled`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-032 — List/read advertisers (advertisers)

- **Suggested binding (optional):** `GET /v1/advertisers`
- **Capability:** `catalog`; **caller/security scope:** `catalog:read`.
- **Input contract:** `q?,country?,channel?,page[after]?`
- **Outcome contract:** `200 {data:[advertiser],meta}`
- **Logical entities touched:** `advertisers`, `network_advertisers`, `programs`, `program_eligibility`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-033 — List/read programs (programs)

- **Suggested binding (optional):** `GET /v1/programs`
- **Capability:** `catalog`; **caller/security scope:** `catalog:read`.
- **Input contract:** `property_id,advertiser_id?,page[after]?`
- **Outcome contract:** `200 {data:[program],meta}`
- **Logical entities touched:** `programs`, `program_eligibility`, `publisher_program_approvals`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-034 — List/read programs resource

- **Suggested binding (optional):** `GET /v1/programs/{id}`
- **Capability:** `catalog`; **caller/security scope:** `catalog:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {program,eligibility,terms_version}`
- **Logical entities touched:** `programs`, `program_eligibility`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-035 — Create/execute request approval (programs)

- **Suggested binding (optional):** `POST /v1/programs/{id}/request-approval`
- **Capability:** `catalog`; **caller/security scope:** `catalog:write`.
- **Input contract:** `{property_id}`
- **Outcome contract:** `202 {state:"pending"}`
- **Logical entities touched:** `publisher_program_approvals`, `audit_logs`.
- **Expected domain event:** `program.approval_requested`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-036 — Create affiliate link

- **Suggested binding (optional):** `POST /v1/links`
- **Capability:** `link`; **caller/security scope:** `links:write`.
- **Input contract:** `{property_id,destination_url,program_id?,expires_at?}`
- **Outcome contract:** `201 {id,short_url,status}`
- **Logical entities touched:** `links`, `link_routes`, `publisher_program_approvals`, `idempotency_requests`, `outbox_events`.
- **Expected domain event:** `link.created`
- **Legacy transport error mapping (illustrative):** `400,401,403,409,422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Idempotency-Key required; normalize merchant host; forbid initial page renderingF, redirects to private IP, bypass, and unapproved deep link.

### API-037 — List/read links (links)

- **Suggested binding (optional):** `GET /v1/links`
- **Capability:** `link`; **caller/security scope:** `links:read`.
- **Input contract:** `property_id?,page[size]?,page[after]?`
- **Outcome contract:** `200 {data:[link],meta}`
- **Logical entities touched:** `links`, `link_routes`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-038 — List/read links resource

- **Suggested binding (optional):** `GET /v1/links/{id}`
- **Capability:** `link`; **caller/security scope:** `links:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {link,routes}`
- **Logical entities touched:** `links`, `link_routes`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-039 — Update links resource

- **Suggested binding (optional):** `PATCH /v1/links/{id}`
- **Capability:** `link`; **caller/security scope:** `links:write`.
- **Input contract:** `{expires_at?,status?}`
- **Outcome contract:** `200 {link}`
- **Logical entities touched:** `links`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `link.updated`
- **Legacy transport error mapping (illustrative):** `401,403,404,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-040 — Create/execute disable (links)

- **Suggested binding (optional):** `POST /v1/links/{id}/disable`
- **Capability:** `link`; **caller/security scope:** `links:write`.
- **Input contract:** `{reason}`
- **Outcome contract:** `202 {status:"disabled"}`
- **Logical entities touched:** `links`, `link_routes`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `link.disabled`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-041 — Create/execute bulk (links)

- **Suggested binding (optional):** `POST /v1/links/bulk`
- **Capability:** `link`; **caller/security scope:** `links:write`.
- **Input contract:** `{property_id,upload_ref}`
- **Outcome contract:** `202 {job_id,status}`
- **Logical entities touched:** `link_bulk_jobs`, `idempotency_requests`.
- **Expected domain event:** `link.bulk_requested`
- **Legacy transport error mapping (illustrative):** `400,401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-042 — List/read links resource

- **Suggested binding (optional):** `GET /v1/links/bulk/{id}`
- **Capability:** `link`; **caller/security scope:** `links:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {state,processed,failed,error_export_url?}`
- **Logical entities touched:** `link_bulk_jobs`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-043 — Resolve visitor redirect

- **Suggested binding (optional):** `GET /r/{token}`
- **Capability:** `link`; **caller/security scope:** `public`.
- **Input contract:** `opaque token only`
- **Outcome contract:** `302 Location approved tracking URL or 410/503`
- **Logical entities touched:** `links`, `link_routes`, `program_eligibility`, `click_attributions`.
- **Expected domain event:** `click.recorded`
- **Legacy transport error mapping (illustrative):** `410,429,503`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. redirect runtime, fast-access state-cached signed immutable route; never trust arbitrary query destination; no primary persistent state request in hot path.

### API-044 — Create/execute click (events)

- **Suggested binding (optional):** `POST /internal/v1/events/click`
- **Capability:** `tracking`; **caller/security scope:** `service:mtls`.
- **Input contract:** `{event_id,click_id,link_id,route_id,at,consent_mode,status}`
- **Outcome contract:** `202 {accepted:true}`
- **Logical entities touched:** `click_attributions`, `outbox_events`.
- **Expected domain event:** `click.ingested`
- **Legacy transport error mapping (illustrative):** `400,401,403,409,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Service-only mTLS/HMAC, minimal trusted fields; durable ingest before 202. Redirect never blocks indefinitely on ingestion.

### API-045 — List/read clicks (reports)

- **Suggested binding (optional):** `GET /v1/reports/clicks`
- **Capability:** `reports`; **caller/security scope:** `reports:read`.
- **Input contract:** `property_id?,from,to,granularity`
- **Outcome contract:** `200 {series,raw_count,qualified_count,as_of}`
- **Logical entities touched:** `click_events`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-046 — List/read conversions (reports)

- **Suggested binding (optional):** `GET /v1/reports/conversions`
- **Capability:** `reports`; **caller/security scope:** `reports:read`.
- **Input contract:** `property_id?,from,to,status?`
- **Outcome contract:** `200 {data,meta,source_freshness}`
- **Logical entities touched:** `conversions`, `conversion_status_events`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-047 — List/read earnings (reports)

- **Suggested binding (optional):** `GET /v1/reports/earnings`
- **Capability:** `reports`; **caller/security scope:** `reports:read`.
- **Input contract:** `property_id?,from,to,currency`
- **Outcome contract:** `200 {pending,approved,cleared,payable,paid,currency}`
- **Logical entities touched:** `commission_splits`, `ledger_postings`, `settlement_allocations`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-048 — Create/execute exports (reports)

- **Suggested binding (optional):** `POST /v1/reports/exports`
- **Capability:** `reports`; **caller/security scope:** `reports:write`.
- **Input contract:** `{type,filters,format:"csv"}`
- **Outcome contract:** `202 {job_id}`
- **Logical entities touched:** `scheduled_exports`, `idempotency_requests`.
- **Expected domain event:** `export.requested`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-049 — List/read reports resource

- **Suggested binding (optional):** `GET /v1/reports/exports/{id}`
- **Capability:** `reports`; **caller/security scope:** `reports:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {state,download_url?,expires_at?}`
- **Logical entities touched:** `scheduled_exports`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-050 — List source conversions

- **Suggested binding (optional):** `GET /v1/conversions`
- **Capability:** `finance`; **caller/security scope:** `conversions:read`.
- **Input contract:** `from,to,status?,page[after]?`
- **Outcome contract:** `200 {data:[conversion],meta}`
- **Logical entities touched:** `conversions`, `conversion_adjustments`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-051 — Read publisher balance

- **Suggested binding (optional):** `GET /v1/balances`
- **Capability:** `finance`; **caller/security scope:** `balances:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {currency_balances:[{currency,pending,cleared,held,inflight,available}]}`
- **Logical entities touched:** `publisher_balances`, `ledger_postings`, `settlement_allocations`, `payout_holds`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-052 — List/read statements (statements)

- **Suggested binding (optional):** `GET /v1/statements`
- **Capability:** `finance`; **caller/security scope:** `balances:read`.
- **Input contract:** `year?,month?,currency?`
- **Outcome contract:** `200 {data:[statement]}`
- **Logical entities touched:** `statements`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-053 — List/read download (statements)

- **Suggested binding (optional):** `GET /v1/statements/{id}/download`
- **Capability:** `finance`; **caller/security scope:** `balances:read`.
- **Input contract:** `none`
- **Outcome contract:** `302 short-lived signed object URL`
- **Logical entities touched:** `statements`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-054 — List/read payout methods (payout methods)

- **Suggested binding (optional):** `GET /v1/payout-methods`
- **Capability:** `finance`; **caller/security scope:** `payouts:read`.
- **Input contract:** `none`
- **Outcome contract:** `200 {data:[method]}`
- **Logical entities touched:** `payout_methods`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-055 — Create/execute payout methods (payout methods)

- **Suggested binding (optional):** `POST /v1/payout-methods`
- **Capability:** `finance`; **caller/security scope:** `payouts:write`.
- **Input contract:** `{provider,provider_token,country,currency}`
- **Outcome contract:** `201 {id,state:"pending"}`
- **Logical entities touched:** `payout_methods`, `audit_logs`.
- **Expected domain event:** `payout_method.created`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Provider token only, no bank/card data; supported country+currency+KYB status check.

### API-056 — Revoke/remove payout methods resource

- **Suggested binding (optional):** `DELETE /v1/payout-methods/{id}`
- **Capability:** `finance`; **caller/security scope:** `payouts:write`.
- **Input contract:** `none`
- **Outcome contract:** `204`
- **Logical entities touched:** `payout_methods`, `payouts`, `audit_logs`.
- **Expected domain event:** `payout_method.deleted`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-057 — List/read payouts (payouts)

- **Suggested binding (optional):** `GET /v1/payouts`
- **Capability:** `finance`; **caller/security scope:** `payouts:read`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `payouts`, `payout_batches`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-058 — Request publisher payout

- **Suggested binding (optional):** `POST /v1/payouts/request`
- **Capability:** `finance`; **caller/security scope:** `payouts:write`.
- **Input contract:** `{currency,amount_minor,method_id}`
- **Outcome contract:** `202 {payout_id,state:"requested"}`
- **Logical entities touched:** `publisher_balances`, `payouts`, `idempotency_requests`, `payout_holds`.
- **Expected domain event:** `payout.requested`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. If self-service enabled; must be funded, reserve atomically, hard enforce threshold and country eligibility.

### API-059 — List/read api keys (api keys)

- **Suggested binding (optional):** `GET /v1/api-keys`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `none`
- **Outcome contract:** `200 {data:[metadata_only]}`
- **Logical entities touched:** `api_keys`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-060 — Create/execute api keys (api keys)

- **Suggested binding (optional):** `POST /v1/api-keys`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `{name,property_id?,scopes,expires_at?}`
- **Outcome contract:** `201 {id,prefix,secret_once}`
- **Logical entities touched:** `api_keys`, `audit_logs`.
- **Expected domain event:** `api_key.created`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Secret visible once only, stored as hash; rate limit and owner MFA.

### API-061 — Revoke/remove api keys resource

- **Suggested binding (optional):** `DELETE /v1/api-keys/{id}`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `none`
- **Outcome contract:** `204`
- **Logical entities touched:** `api_keys`, `audit_logs`.
- **Expected domain event:** `api_key.revoked`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-062 — Create/execute rotate (api keys)

- **Suggested binding (optional):** `POST /v1/api-keys/{id}/rotate`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `{overlap_seconds?}`
- **Outcome contract:** `201 {new_key_secret_once}`
- **Logical entities touched:** `api_keys`, `audit_logs`.
- **Expected domain event:** `api_key.rotated`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-063 — List/read webhooks (webhooks)

- **Suggested binding (optional):** `GET /v1/webhooks`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `none`
- **Outcome contract:** `200 {data:[endpoint]}`
- **Logical entities touched:** `webhook_endpoints`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-064 — Create/execute webhooks (webhooks)

- **Suggested binding (optional):** `POST /v1/webhooks`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `{url,event_types}`
- **Outcome contract:** `201 {id,signing_secret_once,state:"pending"}`
- **Logical entities touched:** `webhook_endpoints`, `audit_logs`.
- **Expected domain event:** `webhook.created`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. HTTPS, DNS resolution at dispatch time plus private IP blocking; challenge callback to activate.

### API-065 — Update webhooks resource

- **Suggested binding (optional):** `PATCH /v1/webhooks/{id}`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `{url?,events?,state?}`
- **Outcome contract:** `200 {endpoint}`
- **Logical entities touched:** `webhook_endpoints`, `audit_logs`.
- **Expected domain event:** `webhook.updated`
- **Legacy transport error mapping (illustrative):** `401,403,404,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-066 — List/read deliveries (webhooks)

- **Suggested binding (optional):** `GET /v1/webhooks/{id}/deliveries`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data:[delivery]}`
- **Logical entities touched:** `webhook_deliveries`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-067 — Create/execute test (webhooks)

- **Suggested binding (optional):** `POST /v1/webhooks/{id}/test`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `{event_type}`
- **Outcome contract:** `202 {delivery_id}`
- **Logical entities touched:** `webhook_deliveries`.
- **Expected domain event:** `webhook.test_requested`
- **Legacy transport error mapping (illustrative):** `401,403,404,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-068 — Create/execute rotate secret (webhooks)

- **Suggested binding (optional):** `POST /v1/webhooks/{id}/rotate-secret`
- **Capability:** `developer`; **caller/security scope:** `session:owner`.
- **Input contract:** `{}`
- **Outcome contract:** `201 {secret_once,overlap_until}`
- **Logical entities touched:** `webhook_endpoints`, `audit_logs`.
- **Expected domain event:** `webhook.secret_rotated`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-069 — List/read review queue (admin)

- **Suggested binding (optional):** `GET /v1/admin/publishers/review-queue`
- **Capability:** `admin`; **caller/security scope:** `admin:reviewer`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `publishers`, `publisher_kyb`, `properties`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-070 — Create/execute decision (admin)

- **Suggested binding (optional):** `POST /v1/admin/publishers/{id}/decision`
- **Capability:** `admin`; **caller/security scope:** `admin:reviewer`.
- **Input contract:** `{decision:"approve"|"reject",reason_code,evidence_ref}`
- **Outcome contract:** `200 {status}`
- **Logical entities touched:** `publishers`, `audit_logs`, `outbox_events`.
- **Expected domain event:** `publisher.reviewed`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-071 — List/read review queue (admin)

- **Suggested binding (optional):** `GET /v1/admin/properties/review-queue`
- **Capability:** `admin`; **caller/security scope:** `admin:reviewer`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `properties`, `property_approval_reviews`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-072 — Create/execute decision (admin)

- **Suggested binding (optional):** `POST /v1/admin/properties/{id}/decision`
- **Capability:** `admin`; **caller/security scope:** `admin:reviewer`.
- **Input contract:** `{decision,reason_code,evidence_ref}`
- **Outcome contract:** `200 {approval_status}`
- **Logical entities touched:** `properties`, `property_approval_reviews`, `audit_logs`, `outbox_events`.
- **Expected domain event:** `property.reviewed`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-073 — List/read integrations (admin)

- **Suggested binding (optional):** `GET /v1/admin/integrations`
- **Capability:** `admin`; **caller/security scope:** `admin:ops`.
- **Input contract:** `none`
- **Outcome contract:** `200 {data:[integration_health]}`
- **Logical entities touched:** `networks`, `network_partnerships`, `network_accounts`, `network_sync_cursors`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-074 — Create/execute sync (admin)

- **Suggested binding (optional):** `POST /v1/admin/integrations/{id}/sync`
- **Capability:** `admin`; **caller/security scope:** `admin:ops`.
- **Input contract:** `{resource,dry_run?}`
- **Outcome contract:** `202 {job_id}`
- **Logical entities touched:** `network_import_batches`, `network_sync_cursors`.
- **Expected domain event:** `network.sync_requested`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-075 — List/read exceptions (admin)

- **Suggested binding (optional):** `GET /v1/admin/conversions/exceptions`
- **Capability:** `admin`; **caller/security scope:** `admin:finance`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `attribution_exceptions`, `reconciliation_exceptions`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-076 — Create/execute resolve (admin)

- **Suggested binding (optional):** `POST /v1/admin/conversions/exceptions/{id}/resolve`
- **Capability:** `admin`; **caller/security scope:** `admin:finance`.
- **Input contract:** `{resolution,evidence_ref}`
- **Outcome contract:** `200 {state}`
- **Logical entities touched:** `attribution_exceptions`, `conversions`, `audit_logs`.
- **Expected domain event:** `attribution.resolved`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-077 — List/read settlements (admin)

- **Suggested binding (optional):** `GET /v1/admin/settlements`
- **Capability:** `admin`; **caller/security scope:** `admin:finance`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `settlement_receipts`, `settlement_allocations`, `reconciliation_exceptions`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-078 — Create/execute import (admin)

- **Suggested binding (optional):** `POST /v1/admin/settlements/import`
- **Capability:** `admin`; **caller/security scope:** `admin:finance`.
- **Input contract:** `{network_id,object_ref,sha256_digest}`
- **Outcome contract:** `202 {batch_id}`
- **Logical entities touched:** `network_import_batches`, `settlement_receipts`, `idempotency_requests`.
- **Expected domain event:** `settlement.import_requested`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-079 — List/read payout batches (admin)

- **Suggested binding (optional):** `GET /v1/admin/payout-batches`
- **Capability:** `admin`; **caller/security scope:** `admin:finance`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `payout_batches`, `payouts`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-080 — Create/execute payout batches (admin)

- **Suggested binding (optional):** `POST /v1/admin/payout-batches`
- **Capability:** `admin`; **caller/security scope:** `admin:finance`.
- **Input contract:** `{currency,period_start,period_end}`
- **Outcome contract:** `201 {batch_id,state:"draft"}`
- **Logical entities touched:** `payout_batches`, `payouts`, `publisher_balances`, `idempotency_requests`.
- **Expected domain event:** `payout_batch.prepared`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-081 — Create/execute approve (admin)

- **Suggested binding (optional):** `POST /v1/admin/payout-batches/{id}/approve`
- **Capability:** `admin`; **caller/security scope:** `admin:finance-approver:mfa`.
- **Input contract:** `{approval_reason}`
- **Outcome contract:** `200 {state:"approved"}`
- **Logical entities touched:** `payout_batches`, `payouts`, `audit_logs`.
- **Expected domain event:** `payout_batch.approved`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Approver cannot be batch creator; second person with MFA; enforce no self-approval in persistent state and service layer.

### API-082 — Create/execute release (admin)

- **Suggested binding (optional):** `POST /v1/admin/payout-batches/{id}/release`
- **Capability:** `admin`; **caller/security scope:** `admin:finance-approver:mfa`.
- **Input contract:** `{}`
- **Outcome contract:** `202 {state:"processing"}`
- **Logical entities touched:** `payout_batches`, `payouts`, `payout_attempts`, `outbox_events`.
- **Expected domain event:** `payout_batch.released`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-083 — List/read risk flags (admin)

- **Suggested binding (optional):** `GET /v1/admin/risk-flags`
- **Capability:** `admin`; **caller/security scope:** `admin:risk`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `risk_flags`, `risk_appeals`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-084 — Create/execute decision (admin)

- **Suggested binding (optional):** `POST /v1/admin/risk-flags/{id}/decision`
- **Capability:** `admin`; **caller/security scope:** `admin:risk`.
- **Input contract:** `{decision,reason,evidence_ref}`
- **Outcome contract:** `200 {state}`
- **Logical entities touched:** `risk_flags`, `properties`, `links`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `risk.flag_resolved`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-085 — Create/execute kill switch (admin)

- **Suggested binding (optional):** `POST /v1/admin/kill-switch`
- **Capability:** `admin`; **caller/security scope:** `admin:security:mfa`.
- **Input contract:** `{scope,scope_id,enabled,reason}`
- **Outcome contract:** `202 {generation,propagation_expected_within_seconds:60}`
- **Logical entities touched:** `feature_flags`, `links`, `link_routes`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `routing.revoked`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-086 — List/read audit logs (admin)

- **Suggested binding (optional):** `GET /v1/admin/audit-logs`
- **Capability:** `admin`; **caller/security scope:** `admin:auditor`.
- **Input contract:** `entity_type?,actor_id?,from,to,page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `audit_logs`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-087 — List/read privacy requests (admin)

- **Suggested binding (optional):** `GET /v1/admin/privacy-requests`
- **Capability:** `admin`; **caller/security scope:** `admin:privacy`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data,meta}`
- **Logical entities touched:** `privacy_requests`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-088 — Create/execute resolve (admin)

- **Suggested binding (optional):** `POST /v1/admin/privacy-requests/{id}/resolve`
- **Capability:** `admin`; **caller/security scope:** `admin:privacy`.
- **Input contract:** `{disposition,evidence_ref}`
- **Outcome contract:** `200 {state}`
- **Logical entities touched:** `privacy_requests`, `audit_logs`.
- **Expected domain event:** `privacy.request_resolved`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-089 — List/read optimize resource

- **Suggested binding (optional):** `GET /v1/optimize/config/{public_key}`
- **Capability:** `optimize`; **caller/security scope:** `public:origin-limited`.
- **Input contract:** `origin header, cache validators`
- **Outcome contract:** `200 {policy_version,approved_hosts,selectors,consent_mode}`
- **Logical entities touched:** `sdk_installations`, `consent_configs`, `monetization_rules`, `properties`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `400,403,410,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. No API secret; validate registered property origin against allowed origins. Origin alone is not identity proof.

### API-090 — Create/execute resolve batch (optimize)

- **Suggested binding (optional):** `POST /v1/optimize/resolve-batch`
- **Capability:** `optimize`; **caller/security scope:** `public:origin-limited`.
- **Input contract:** `{public_key,links:[{url,element_id}],consent_mode}`
- **Outcome contract:** `200 {decisions:[{element_id,action,url?,reason}]}`
- **Logical entities touched:** `monetization_rules`, `program_eligibility`, `links`, `link_routes`.
- **Expected domain event:** `optimize.decision_made`
- **Legacy transport error mapping (illustrative):** `400,403,422,429`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Max batch 50, reject >32KB; only merchant allowlist; no raw page content, no visitor tracking cookies unless consent.

### API-091 — List/read rules (optimize)

- **Suggested binding (optional):** `GET /v1/optimize/rules`
- **Capability:** `optimize`; **caller/security scope:** `session:editor`.
- **Input contract:** `property_id`
- **Outcome contract:** `200 {data,policy_version}`
- **Logical entities touched:** `monetization_rules`, `consent_configs`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-092 — Replace rules (optimize)

- **Suggested binding (optional):** `PUT /v1/optimize/rules`
- **Capability:** `optimize`; **caller/security scope:** `session:editor`.
- **Input contract:** `{property_id,rules,expected_policy_version}`
- **Outcome contract:** `200 {policy_version}`
- **Logical entities touched:** `monetization_rules`, `consent_configs`, `outbox_events`.
- **Expected domain event:** `optimize.policy_updated`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-093 — Create/execute installations (optimize)

- **Suggested binding (optional):** `POST /v1/optimize/installations`
- **Capability:** `optimize`; **caller/security scope:** `session:editor`.
- **Input contract:** `{property_id,allowed_origins}`
- **Outcome contract:** `201 {public_key,script_snippet}`
- **Logical entities touched:** `sdk_installations`, `properties`.
- **Expected domain event:** `optimize.installation_created`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-094 — Create/execute disable (optimize)

- **Suggested binding (optional):** `POST /v1/optimize/installations/{id}/disable`
- **Capability:** `optimize`; **caller/security scope:** `session:editor`.
- **Input contract:** `{}`
- **Outcome contract:** `202 {status:"disabled"}`
- **Logical entities touched:** `sdk_installations`, `outbox_events`.
- **Expected domain event:** `optimize.installation_disabled`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-095 — Create/execute experiments (optimize)

- **Suggested binding (optional):** `POST /v1/optimize/experiments`
- **Capability:** `optimize`; **caller/security scope:** `session:editor`.
- **Input contract:** `{property_id,name,holdout_pct,policy_version}`
- **Outcome contract:** `201 {experiment_id}`
- **Logical entities touched:** `experiments`, `route_decisions`.
- **Expected domain event:** `optimize.experiment_created`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-096 — List/read decisions (optimize)

- **Suggested binding (optional):** `GET /v1/optimize/decisions`
- **Capability:** `optimize`; **caller/security scope:** `session:analyst`.
- **Input contract:** `property_id,from,to`
- **Outcome contract:** `200 {data:[reason_summary]}`
- **Logical entities touched:** `route_decisions`, `experiments`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-097 — List/read live (health)

- **Suggested binding (optional):** `GET /internal/health/live`
- **Capability:** `ops`; **caller/security scope:** `internal`.
- **Input contract:** `none`
- **Outcome contract:** `200 {status:"alive"}`
- **Logical entities touched:** `none`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `503`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-098 — List/read ready (health)

- **Suggested binding (optional):** `GET /internal/health/ready`
- **Capability:** `ops`; **caller/security scope:** `internal`.
- **Input contract:** `none`
- **Outcome contract:** `200 {status:"ready",dependencies}`
- **Logical entities touched:** `none`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `503`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-099 — Create/execute replay (jobs)

- **Suggested binding (optional):** `POST /internal/v1/jobs/replay`
- **Capability:** `ops`; **caller/security scope:** `service:ops`.
- **Input contract:** `{failure_ids,dry_run}`
- **Outcome contract:** `202 {job_ids}`
- **Logical entities touched:** `job_failures`, `inbox_processed_events`.
- **Expected domain event:** `job.replay_requested`
- **Legacy transport error mapping (illustrative):** `401,403,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-100 — Create/execute risk appeals (risk appeals)

- **Suggested binding (optional):** `POST /v1/risk-appeals`
- **Capability:** `publisher`; **caller/security scope:** `session:publisher`.
- **Input contract:** `{risk_flag_id,statement,evidence_ref?}`
- **Outcome contract:** `201 {appeal_id,state:"open"}`
- **Logical entities touched:** `risk_appeals`, `risk_flags`, `audit_logs`.
- **Expected domain event:** `risk.appeal_submitted`
- **Legacy transport error mapping (illustrative):** `401,403,404,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-101 — List/read risk appeals (risk appeals)

- **Suggested binding (optional):** `GET /v1/risk-appeals`
- **Capability:** `publisher`; **caller/security scope:** `session:publisher`.
- **Input contract:** `page[after]?`
- **Outcome contract:** `200 {data:[appeal]}`
- **Logical entities touched:** `risk_appeals`, `risk_flags`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-102 — List/read activations (admin)

- **Suggested binding (optional):** `GET /v1/admin/launch/activations`
- **Capability:** `admin`; **caller/security scope:** `admin:ops`.
- **Input contract:** `country?,channel?`
- **Outcome contract:** `200 {data:[activation]}`
- **Logical entities touched:** `country_activations`, `network_partnerships`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-103 — Create/execute activations (admin)

- **Suggested binding (optional):** `POST /v1/admin/launch/activations`
- **Capability:** `admin`; **caller/security scope:** `admin:ops:mfa`.
- **Input contract:** `{country,channel,network_id,legal_evidence_ref,payout_evidence_ref,approved_by}`
- **Outcome contract:** `201 {id,enabled:false}`
- **Logical entities touched:** `country_activations`, `network_partnerships`, `audit_logs`.
- **Expected domain event:** `launch.activation_requested`
- **Legacy transport error mapping (illustrative):** `401,403,409,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Approval actor must be a different authorized reviewer; require evidence and verify in server rules.

### API-104 — Create/execute enable (admin)

- **Suggested binding (optional):** `POST /v1/admin/launch/activations/{id}/enable`
- **Capability:** `admin`; **caller/security scope:** `admin:release-approver:mfa`.
- **Input contract:** `{approval_reason}`
- **Outcome contract:** `202 {enabled:true,policy_generation}`
- **Logical entities touched:** `country_activations`, `feature_flags`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `launch.country_enabled`
- **Legacy transport error mapping (illustrative):** `401,403,404,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-105 — Create/execute disable (admin)

- **Suggested binding (optional):** `POST /v1/admin/launch/activations/{id}/disable`
- **Capability:** `admin`; **caller/security scope:** `admin:security:mfa`.
- **Input contract:** `{reason}`
- **Outcome contract:** `202 {enabled:false}`
- **Logical entities touched:** `country_activations`, `feature_flags`, `outbox_events`, `audit_logs`.
- **Expected domain event:** `launch.country_disabled`
- **Legacy transport error mapping (illustrative):** `401,403,404`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-106 — Create/execute provider webhook (admin)

- **Suggested binding (optional):** `POST /v1/admin/kyb/provider-webhook`
- **Capability:** `admin`; **caller/security scope:** `provider:webhook`.
- **Input contract:** `signed provider callback event`
- **Outcome contract:** `202`
- **Logical entities touched:** `publisher_kyb`, `publishers`, `audit_logs`.
- **Expected domain event:** `kyb.provider_status_changed`
- **Legacy transport error mapping (illustrative):** `400,401,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-107 — Create/execute webhook (admin)

- **Suggested binding (optional):** `POST /v1/admin/payout-provider/webhook`
- **Capability:** `admin`; **caller/security scope:** `provider:webhook`.
- **Input contract:** `signed provider event with external event id`
- **Outcome contract:** `202`
- **Logical entities touched:** `payouts`, `payout_attempts`, `ledger_journals`, `ledger_postings`.
- **Expected domain event:** `payout.provider_updated`
- **Legacy transport error mapping (illustrative):** `400,401,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-108 — Create/execute webhook (admin)

- **Suggested binding (optional):** `POST /v1/admin/network-provider/webhook`
- **Capability:** `admin`; **caller/security scope:** `provider:webhook`.
- **Input contract:** `signed network callback if adapter supports`
- **Outcome contract:** `202`
- **Logical entities touched:** `network_import_batches`, `conversion_import_rows`, `conversions`.
- **Expected domain event:** `network.report_received`
- **Legacy transport error mapping (illustrative):** `400,401,409`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-109 — Update preferences (publishers)

- **Suggested binding (optional):** `PATCH /v1/publishers/preferences`
- **Capability:** `publisher`; **caller/security scope:** `session:owner`.
- **Input contract:** `{notification_preferences?,default_country?,display_currency?}`
- **Outcome contract:** `200 {preferences}`
- **Logical entities touched:** `publishers`, `audit_logs`.
- **Expected domain event:** `publisher.preferences_updated`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Validate input, active scope and current state; document response and failure behavior.

### API-110 — Preview monetization decision

- **Suggested binding (optional):** `POST /v1/optimize/preview`
- **Capability:** `optimize`; **caller/security scope:** `session:editor`.
- **Input contract:** `{property_id,merchant_url,consent_mode}`
- **Outcome contract:** `200 {action,reason,eligible_routes}`
- **Logical entities touched:** `monetization_rules`, `program_eligibility`, `programs`, `link_routes`.
- **Expected domain event:** `none`
- **Legacy transport error mapping (illustrative):** `401,403,422`.
- **Acceptance:** Correct permission and state checks, typed validation failures, tenant isolation, replay safety for commands, and expected result under transient failure. Preview must not make monetized clicks, may use dry-run policy evaluator only.

### API-111 — Register network account (admin)

- **Suggested binding (optional):** `POST /v1/admin/network-accounts`
- **Capability:** `admin`; **caller/security scope:** `admin:ops`.
- **Input contract:** `{network_id,account_ref,credentials:<adapter-declared typed fields>}`. Adapter schema declares required fields and optional sealed fields, including Rakuten Advanced Reports `web_security_token`.
- **Outcome contract:** `201 {data:{id,network_id,account_ref,credential_status}}`; credential values are never returned.
- **Logical entities touched:** `network_accounts`, `audit_logs`.
- **Expected domain event:** `network.account_registered`.
- **Acceptance:** Ops-only; validate declared fields, seal secrets with key ID, and redact values from responses, errors, diagnostics, and logs. Optional `web_security_token` is scoped to Advanced Reports and is not required for ordinary connection validation.

### API-112 — Rotate network account credentials (admin)

- **Suggested binding (optional):** `PUT /v1/admin/network-accounts/{id}/credentials`
- **Capability:** `admin`; **caller/security scope:** `admin:ops`.
- **Input contract:** `{credentials:<adapter-declared typed fields>}`
- **Outcome contract:** `200 {data:{id,credential_status,rotated_at}}`; values are never returned.
- **Logical entities touched:** `network_accounts`, `audit_logs`.
- **Expected domain event:** `network.account_credentials_rotated`.
- **Acceptance:** Ops-only atomic replacement; audit rotation without values; no old/new secret appears in response, errors, diagnostics, or logs.

### API-113 — Test network account connection (admin)

- **Suggested binding (optional):** `POST /v1/admin/network-accounts/{id}/test-connection`
- **Capability:** `admin`; **caller/security scope:** `admin:ops`.
- **Input contract:** `none`; worker loads account and constructs adapter using stored, unsealed credentials.
- **Outcome contract:** `200 {data:{connection_status,capabilities}}`; no credential values.
- **Logical entities touched:** `network_accounts`.
- **Expected domain event:** `none`.
- **Acceptance:** Return adapter capability profile. API-113 ordinary validation does not require or pass optional `web_security_token`. Advanced Reports CSV settlement behavior with and without that token remains unsupported in WP-4.4a and is assigned to OZE-3274, with TP-W4-039/040 covering the follow-up. Credentials and derived auth material never appear in results or logs.

## Semantic contract examples

### Password recovery — request

```json
{"identity_hint":"publisher@example.invalid"}
```

**Result:** `accepted` with identical visible messaging for known and unknown identities. The service may issue one time-limited single-use proof for eligible identities and request protected delivery. The caller must not learn whether the identity exists.

### Password recovery — completion

```json
{"identity_hint":"publisher@example.invalid", "recovery_proof":"opaque-one-time-proof", "new_secret":"redacted"}
```

**Result:** credential updated, recovery proof invalidated, prior sessions revoked or re-authorized according to security policy; fresh login required. A replay returns `TOKEN_EXPIRED_OR_USED`. UI confirmation of the password is a local UI validation and need not be an API field.

### Create monetization link

```json
{"property_ref":"property-opaque", "destination":"https://merchant.example/item", "program_ref":"program-opaque"}
```

**Result:** stable link identity, activation state, generated link to Moneytrap's redirect capability, applicable eligibility/policy version. Reject unapproved properties, invalid destinations, blocked programs, and disallowed channel/country combinations.

### Convert and reconcile source transaction

```json
{"source_account_ref":"account-opaque", "source_transaction_ref":"tx-123", "source_revision":2, "commission":{"amount":"12.34","currency":"USD"}, "source_status":"approved"}
```

**Result:** source version persisted once, attribution resolved or marked exception, authorized financial effects posted once. A later change is represented as a new revision and reversing/adjusting movements—not destructive overwrite.

### Payout request

```json
{"publisher_ref":"publisher-opaque", "amount":{"amount":"75.00","currency":"USD"}, "payout_destination_ref":"verified-destination", "request_ref":"stable-idempotency-identity"}
```

**Result:** eligibility and funds checked, funds reserved, explicit approval/review if required. A provider timeout produces `outcome_unknown` with reference to the original request, never an automatic second independent payment.

## Public contract lifecycle


- Publish supported operations, capability flags, semantic types, privacy purposes, errors, and deprecation notice.
- Additive changes are compatible; breaking state semantics or removing response meaning require version migration.
- Consumer tests must validate both successful results and error/retry/authorization behavior.
- The suggested paths can be retained for compatibility even when internal architecture changes completely.
