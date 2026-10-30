# Moneytrap — End-to-End Use Cases (Implementation Neutral)

A use case documents a complete observable user or operator outcome. Suggested interface paths and HTTP calls are traceability examples, **not technology requirements**. Conceptual records are logical data; internal stages may be synchronous, asynchronous, or combined so long as outcomes, recovery and invariants hold.

Every use case specifies starting actor, relevant experiences and operations, a normal sequence, failure modes, and executable acceptance conditions.

## Scenarios
### UC01 — Register, verify email and create account

- **Primary actor:** New publisher.
- **Suggested UI navigation:** `/register`, `/verify-email`, `/login`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/auth/register`, `POST /v1/auth/verify-email`, `POST /v1/auth/resend-verification`. *(nonbinding)*
- **Conceptual records:** `users`, `email_verification_tokens`, `notification_templates`, `notification_deliveries`, `audit_logs`.

**Nominal interaction sequence**

1. Visitor enters email/password and accepts versioned Terms on /register.
2. Browser validates fields and submits register.
3. Identity capability normalizes the email, protects the password, and creates pending user and one-time hashed email challenge.
4. Notification delivery step sends short-lived verification link with dedup_key.
5. Visitor opens /verify-email, token is exchanged via POST.
6. API atomically consumes challenge, sets verified_at, emits audit event.
7. UI links to /login and never exposes password hash.

**Failure and recovery behavior**

- Existing email returns documented generic or 409 without leaking private account data.
- Expired or replayed challenge shows resend action.
- Email provider failure remains asynchronous pending for delivery and observable.
- Bot abuse is throttled.

**Conformance acceptance**

- Valid registration + verify creates one active identity.
- Same verification token cannot be used twice.
- Email never sent with raw password.
- Cross-user verification token fails.
- Resend throttling 429.
- Mail provider retry creates no duplicate challenge.

### UC02 — Log in with sessions and mandatory MFA for privileged users

- **Primary actor:** Returning publisher or admin.
- **Suggested UI navigation:** `/login`, `/mfa/challenge`, `/dashboard`, `/settings/security`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/auth/login`, `POST /v1/auth/mfa/challenge`, `GET /v1/auth/me`, `POST /v1/auth/logout`. *(nonbinding)*
- **Conceptual records:** `users`, `auth_sessions`, `mfa_factors`, `audit_logs`.

**Nominal interaction sequence**

1. Login form takes credentials over HTTPS.
2. API verifies password and account state, applies IP/account throttle.
3. If MFA required API returns challenge_id, not full session.
4. Browser moves to /mfa/challenge, submits supported second-factor method challenge.
5. API verifies proof, mints short-lived signed HttpOnly Secure SameSite session credential and request-forgery safeguards for cookie-based implementations.
6. Authorization enforcement resolves user and organization role per request.
7. /dashboard loads profile via /auth/me.
8. Logout revokes session hash and clears cookie.

**Failure and recovery behavior**

- Wrong password generic 401.
- Locked or suspended user 423.
- Stolen MFA challenge expires.
- CSRF rejected on mutation.
- User with no organization goes to onboarding.

**Conformance acceptance**

- Admin without MFA never receives privileged session.
- Browser session credentials meet secure transmission and script-access policies where applicable.
- Session fixed on login cannot be reused.
- Invalid MFA locked/throttled.
- Revoked session gives 401.
- Cross-org switch enforces roles.

### UC03 — Forgot and reset password end-to-end

- **Primary actor:** Publisher who lost account access.
- **Suggested UI navigation:** `/forgot-password`, `/reset-password?token=...&email=...`, `/login`, `/settings/security`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/auth/forgot-password`, `POST /v1/auth/reset-password`, `POST /v1/auth/login`, `GET /v1/auth/sessions`. *(nonbinding)*
- **Conceptual records:** `users`, `password_reset_tokens`, `auth_sessions`, `notification_deliveries`, `audit_logs`.

**Nominal interaction sequence**

1. On /login click Forgot password to /forgot-password.
2. Enter email; API always returns 202 with same message, whether or not account exists.
3. For eligible user create random token, store only token_hash with created_at, request protected delivery of a single-use reset URL.
4. User opens /reset-password?token=...&email=...; set no-referrer and no-store, avoid third-party scripts; UI reads token and does not log it.
5. User enters new password + confirmation; client validates format but API revalidates.
6. POST /auth/reset-password atomically claims the recovery challenge, checks token hash and configured expiration, hashes new password, consumes token, increments users.auth_version, revokes auth_sessions as one indivisible operation.
7. Publish security notice, redirect to /login?reset=success; do not auto-login or bypass MFA.
8. A prior session or repeat token fails, fresh credentials work.

**Failure and recovery behavior**

- Unknown email cannot be enumerated through body or timing.
- Expired token shows request-new-link state without revealing account.
- Invalid or used token returns 410.
- Password mismatch/weak returns 422 with field codes.
- Race of two reset submissions allows exactly one.
- Email outage is retried idempotently.
- Multiple reset requests invalidate the prior token.

**Conformance acceptance**

- Stored recovery proof verification is secure, not plaintext.
- 202 indistinguishable existing vs unknown.
- A proof just before the configured expiration succeeds; immediately after it fails under a controlled clock.
- Concurrent reset attempts exactly one success.
- All previous sessions revoked.
- MFA still required after reset.
- Password and token omitted from analytics, logs and error traces.
- End-to-end UI from /login to /forgot-password to /reset-password to /login with error cases.

### UC04 — Enroll MFA, rotate recovery codes and revoke sessions

- **Primary actor:** Privileged team member.
- **Suggested UI navigation:** `/settings/security`, `/settings/security/mfa`, `/settings/security/sessions`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/auth/mfa/enroll`, `POST /v1/auth/mfa/confirm`, `GET /v1/auth/sessions`, `DELETE /v1/auth/sessions/{session_id}`. *(nonbinding)*
- **Conceptual records:** `users`, `mfa_factors`, `auth_sessions`, `audit_logs`.

**Nominal interaction sequence**

1. Authenticated user re-enters password.
2. Start an approved additional-authentication method enrollment.
3. Server protects pending factor material and never marks active until proof.
4. UI presents enrollment challenge, requests valid proof.
5. Server marks factor confirmed, creates one-time recovery codes stored only as hashes.
6. User downloads recovery codes one time.
7. Sessions page lists hashed device metadata and allows remote session revocation.
8. Sensitive actions require step-up MFA.

**Failure and recovery behavior**

- Wrong factor proof does not activate.
- Recovery codes cannot be viewed again.
- Enrollment cancellation removes pending factor.
- Last admin factor removal requires alternate verified method.
- Revocation races fail closed.

**Conformance acceptance**

- One-time authentication proof replay is rejected.
- Only verified factor grants MFA.
- Recovery code consumed once.
- Remote revoked session cannot call API.
- Secret absent from logs and response after enrollment.

### UC05 — Create organization, invite members and enforce tenant RBAC

- **Primary actor:** Publisher account owner.
- **Suggested UI navigation:** `/onboarding/organization`, `/settings/organization`, `/settings/team`, `/invitations/accept?token=...`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/organizations`, `POST /v1/invitations`, `POST /v1/invitations/accept`, `GET /v1/members`, `DELETE /v1/members/{member_id}`. *(nonbinding)*
- **Conceptual records:** `organizations`, `memberships`, `organization_invites`, `publishers`, `users`, `auth_sessions`, `audit_logs`.

**Nominal interaction sequence**

1. Verified user creates organization (name, country, base currency).
2. Account operation creates organization, owner membership and publisher draft.
3. Owner invites by email with role; token stored hashed.
4. Invitee accepts valid invitation in organization context.
5. Authorization enforcement derives org from validated session selection, checks membership and scoped role.
6. Settings screen shows members and allows role-appropriate removal.
7. Last owner cannot be removed; removal revokes organization-scoped access.

**Failure and recovery behavior**

- Duplicate membership returns 409.
- Expired/used invite returns 410.
- Viewer cannot invite.
- Tenant B identifier requested by Tenant A returns 404.
- Member removed while session active loses access immediately.

**Conformance acceptance**

- All list/detail queries verify membership.
- record-level authorization tests cover every protected API.
- Invite token single-use.
- Last-owner check concurrent safe.
- Invite email retries no duplicate membership.

### UC06 — Submit publisher KYB and administrative approval

- **Primary actor:** Organization owner and compliance reviewer.
- **Suggested UI navigation:** `/onboarding/publisher`, `/onboarding/review`, `/admin/publishers`, `/admin/publishers/[id]`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/publishers/submit`, `GET /v1/publishers/status`, `GET /v1/admin/publishers/review-queue`, `POST /v1/admin/publishers/{id}/decision`. *(nonbinding)*
- **Conceptual records:** `publishers`, `publisher_kyb`, `audit_logs`, `notification_deliveries`.

**Nominal interaction sequence**

1. Owner submits account details and starts hosted KYB provider session if required.
2. API stores only provider reference and draft/in_review state.
3. Admin asynchronous delivery mechanism displays risk signals and evidence references, not sensitive raw documents.
4. Reviewer approves/rejects with reason and logs actor/timestamp.
5. Publisher receives status notification and dashboard state changes.
6. All link creation blocked unless publisher approved.

**Failure and recovery behavior**

- Unverified organization cannot submit.
- Reviewer without privilege denied.
- Rejected publisher gets safe explanation/resubmission route.
- Provider unavailable remains pending, never auto-approves.

**Conformance acceptance**

- Status transition draft->in_review->approved audited.
- No self-approved privilege escalation.
- Suspended publisher links fail closed.
- KYB PII never lands in application logs.

### UC07 — Verify website, social, mobile app and API properties

- **Primary actor:** Approved publisher.
- **Suggested UI navigation:** `/properties`, `/properties/new`, `/properties/[id]/verify`, `/properties/[id]/review`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/properties`, `POST /v1/properties/{id}/verification-challenge`, `POST /v1/properties/{id}/verify`, `POST /v1/properties/{id}/submit`, `GET /v1/properties/{id}`. *(nonbinding)*
- **Conceptual records:** `properties`, `property_verifications`, `property_approval_reviews`, `audit_logs`.

**Nominal interaction sequence**

1. Publisher chooses website/social/app/API traffic source and enters normalized identifier.
2. Service stores canonical and normalized value with country/channel.
3. For website choose DNS TXT or HTML/meta challenge; display exact instructions.
4. Verification background processor resolves public DNS/HTTPS with initial page renderingF protection and bounded timeouts.
5. For social/app/api use documented manual or supported provider verification, not a fake website challenge.
6. Verified property submitted for independent compliance approval.
7. UI renders pending, failed, rejected, approved with recheck instructions.

**Failure and recovery behavior**

- Domain points to private IP blocked.
- DNS rebinding blocked.
- Unicode homograph/duplicate host normalization.
- Social property no unsupported automated approval.
- Challenge expired/incorrect remains pending.

**Conformance acceptance**

- Three valid website ownership methods pass when applicable.
- Private/loopback fetch rejected.
- Duplicate normalized property unique.
- Verification not equivalent to advertiser eligibility.
- Cross-tenant verify forbidden.

### UC08 — Review, approve, suspend and revoke publisher properties

- **Primary actor:** Compliance reviewer.
- **Suggested UI navigation:** `/admin/properties`, `/admin/properties/[id]`, `/properties/[id]`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/admin/properties/review-queue`, `POST /v1/admin/properties/{id}/decision`, `POST /v1/properties/{id}/disable`. *(nonbinding)*
- **Conceptual records:** `properties`, `property_approval_reviews`, `link_routes`, `outbox_events`, `audit_logs`.

**Nominal interaction sequence**

1. Reviewer opens asynchronous delivery mechanism filtered by channel, country and source.
2. Inspects verification evidence and upstream permitted traffic methods.
3. Approves or rejects with reason and records terms snapshot.
4. Policy engine updates property state and emits route eligibility invalidation.
5. Suspended properties lose ability to create links or redirect monetized traffic <=60s.
6. Publisher sees actionable status.

**Failure and recovery behavior**

- Unknown channel is denied.
- Suspended property cannot bypass via stale fast-access state cache.
- Reject without reason blocked.
- Reviewer cannot approve forbidden upstream channel.

**Conformance acceptance**

- Every decision has audit actor and reason.
- Route kill-switch integration test <=60s.
- Duplicate approval replay idempotent.
- Reviewer permissions enforced.

### UC09 — Configure affiliate network account and authorize adapter

- **Primary actor:** Internal integration administrator.
- **Suggested UI navigation:** `/admin/integrations`, `/admin/integrations/[id]`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/admin/integrations`, `POST /v1/admin/integrations/{id}/sync`. *(nonbinding)*
- **Conceptual records:** `networks`, `network_partnerships`, `network_accounts`, `network_sync_cursors`, `audit_logs`.

**Nominal interaction sequence**

1. Commercial uploads signed approval evidence and permitted scopes.
2. Admin configures network account with vault secret reference, not raw secret in persistent state.
3. Adapter validates auth and capability matrix in sandbox.
4. Production flag remains disabled until partnership active and country/channel activation approved.
5. Sync schedules initialize cursors and collect partner API health.
6. Admin UI shows last success/error and disabled capabilities.

**Failure and recovery behavior**

- Missing written permission stops production activation.
- Revoked API token disables sync and route templates.
- Unsupported settlement capability never appears as supported.
- Partner 429 uses backoff.

**Conformance acceptance**

- No upstream secret saved in logs/persistent state.
- Invalid partner agreement cannot be enabled.
- Contract expiry cancels eligible routes.
- Adapter contract mocks pass on failure/retry.

### UC10 — Synchronize advertisers, programs and source eligibility

- **Primary actor:** Publisher browsing offer catalog.
- **Suggested UI navigation:** `/advertisers`, `/advertisers/[id]`, `/programs/[id]`, `/admin/integrations/[id]`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/advertisers`, `GET /v1/programs`, `GET /v1/programs/{id}`, `POST /v1/programs/{id}/request-approval`. *(nonbinding)*
- **Conceptual records:** `advertisers`, `advertiser_domains`, `network_advertisers`, `programs`, `program_eligibility`, `publisher_program_approvals`, `network_sync_cursors`.

**Nominal interaction sequence**

1. Adapter reads program pages using cursor/rate limits.
2. Normalize advertiser identity and verified merchant domains.
3. Upsert external IDs, catalog terms, validity, deep-link permissions, supported countries/channels.
4. Publisher searches offers filtered by own approved property.
5. Eligibility service intersects contract country/channel, publisher property, program approval and fresh sync.
6. Publisher requests per-program approval when required.
7. UI shows eligibility reason and last sync timestamp.

**Failure and recovery behavior**

- Empty/stale approval unknown -> denied.
- Duplicate external IDs update expected row.
- Renamed network advertiser does not split catalog.
- Deactivated program invalidates routes.

**Conformance acceptance**

- Fixture sync converges after two replays.
- Unauthorized catalog offer not advertised as monetizable.
- Every route decision cites terms version.
- Provider pagination and 429 handled.

### UC11 — Create, preview, edit and revoke deep links

- **Primary actor:** Publisher/content editor.
- **Suggested UI navigation:** `/links`, `/links/new`, `/links/[id]`, `/advertisers/[id]`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/links`, `GET /v1/links`, `GET /v1/links/{id}`, `PATCH /v1/links/{id}`, `POST /v1/links/{id}/disable`. *(nonbinding)*
- **Conceptual records:** `links`, `link_routes`, `publisher_program_approvals`, `program_eligibility`, `idempotency_requests`, `outbox_events`, `audit_logs`.

**Nominal interaction sequence**

1. Publisher opens /links/new selecting approved property and destination URL.
2. UI validates http/https, previews normalized merchant and program eligibility.
3. API independently verifies ownership, partnership, channel, merchant hostname, current terms and deep-link capability.
4. Transaction stores link, route generation and idempotency result.
5. UI displays copyable short URL and preview without exposing partner secrets.
6. Revoke action changes status and publishes cache invalidation.
7. Old short link no longer monetizes after propagation deadline.

**Failure and recovery behavior**

- Invalid scheme, credentialed URL, localhost/private IP, redirect chain to denied host -> 422.
- Unapproved program -> 403.
- Concurrent same Idempotency-Key+payload -> one link.
- Same key different payload -> 409.
- Network unavailable cannot invent live tracking URL.

**Conformance acceptance**

- Owner can make exactly one link with retry.
- Foreign property 404.
- URL sanitizer fuzz cases.
- Revoked route never monetizes after 60s.
- UI copy link disabled on rejected draft.

### UC12 — Bulk CSV link creation with per-row failure reporting

- **Primary actor:** Bulk publisher/editor.
- **Suggested UI navigation:** `/links/import`, `/links/import/[jobId]`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/links/bulk`, `GET /v1/links/bulk/{id}`, `GET /v1/reports/exports/{id}`. *(nonbinding)*
- **Conceptual records:** `link_bulk_jobs`, `links`, `link_routes`, `scheduled_exports`, `idempotency_requests`.

**Nominal interaction sequence**

1. Publisher uploads sanitized CSV to signed object storage, chooses property and mapping columns.
2. API validates media type/size and schedule for deliverys bulk job.
3. Worker streams rows, validates each URL with same link service (never a bypass).
4. Valid rows create routes under idempotent row key.
5. Invalid rows accumulate reason codes in downloadable errors CSV.
6. Progress screen polls job and offers successful link export.

**Failure and recovery behavior**

- Oversized CSV 413.
- Formula-injection output escaped.
- Worker crash resumes without duplicate links.
- Cross-tenant upload reference rejected.
- Network eligibility change during job produces row-level rejected state.

**Conformance acceptance**

- Mixed CSV creates expected success and failure counts.
- Replay same job no duplicate routes.
- CSV export safe against formula injection.
- Job cannot read another tenant object.

### UC13 — Redirect visitor safely through approved tracking route

- **Primary actor:** Anonymous visitor clicking a publisher link.
- **Suggested UI navigation:** `/r/[token] (visitor redirect experience)`. *(aliases only)*
- **Suggested API bindings:** `GET /r/{token}`, `POST /internal/v1/events/click`. *(nonbinding)*
- **Conceptual records:** `links`, `link_routes`, `program_eligibility`, `network_partnerships`, `click_attributions`, `outbox_events`.

**Nominal interaction sequence**

1. Visitor GET /r/opaque_token.
2. redirect service parses bounded opaque token; looks up signed cached preapproved route.
3. Validate route generation, network contract, property activation, country/channel and deny list.
4. Generate globally unique click_id, insert required attribution reference through durable async ingest (never block beyond budget).
5. Render authorized adapter tracking URL with approved subpublisher/click fields.
6. Respond 302 with Location allowlisted network tracking host, Cache-Control no-store, no sensitive cookie.
7. Ingest click event and derive raw/qualified reporting asynchronously.

**Failure and recovery behavior**

- Missing/invalid token 410.
- fast-access state unavailable -> approved unmonetized destination only if safe policy explicitly allows or 503.
- Revoked link cache invalid <=60s.
- No user-supplied ?url= override.
- Queue outage never routes to arbitrary host.

**Conformance acceptance**

- p95 service <=100ms and p99 <=250ms under documented workload.
- fuzz host and token.
- stale permission/kill switch fails closed.
- 302 never points to loopback/private host.
- duplicate click ingestion not duplicated in analytics.

### UC14 — Ingest click events and show qualified analytics

- **Primary actor:** Publisher and analytics operator.
- **Suggested UI navigation:** `/reports/clicks`, `/admin/operations/queues`. *(aliases only)*
- **Suggested API bindings:** `POST /internal/v1/events/click`, `GET /v1/reports/clicks`. *(nonbinding)*
- **Conceptual records:** `click_attributions`, `outbox_events`, `inbox_processed_events`, `click_events`, `publisher_daily_click_rollup`.

**Nominal interaction sequence**

1. Redirect emits event_id/click_id/route/policy version.
2. Trusted collector durably persists or asynchronous delivery mechanisms, returns 202.
3. analytical view consumer validates event schema and version, classifies bot/qualified.
4. Report query deduplicates by click_id and scopes publisher/property/time.
5. UI labels raw vs qualified and as_of timestamp.
6. Admin monitors lag/replays gaps.

**Failure and recovery behavior**

- Duplicate recovery handler delivery must not double count.
- Queue lag displays stale reports.
- Missing schema version goes DLQ.
- Raw IP and identifiers not stored beyond configured privacy policy.
- Browser does not directly call internal collector.

**Conformance acceptance**

- 100 duplicate events count as 1 unique click.
- Property scope enforced at read.
- Stale data visible in UI.
- 24h replay/backfill target measurable.

### UC15 — Import upstream conversions and match allowed attribution

- **Primary actor:** Network integration/finance worker.
- **Suggested UI navigation:** `/admin/integrations/[id]/imports`, `/admin/conversions/exceptions`, `/reports/conversions`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/admin/integrations/{id}/sync`, `GET /v1/admin/conversions/exceptions`, `GET /v1/reports/conversions`. *(nonbinding)*
- **Conceptual records:** `network_import_batches`, `conversion_import_rows`, `conversions`, `conversion_status_events`, `click_attributions`, `attribution_exceptions`.

**Nominal interaction sequence**

1. Scheduler requests partner transactions with permitted range and cursor.
2. Store original file/blob encrypted, SHA256 digest, parser version and partner timestamps.
3. Parser normalizes source status, money/currency, external transaction+line IDs.
4. Map allowed sub-ID/click reference to click_attributions within retention, otherwise create attribution exception.
5. Upsert by unique network/external_txn/line and record versioned status events.
6. UI shows pending/approved/rejected, reason and partner sync time without fabricating conversions.

**Failure and recovery behavior**

- Duplicate file digest yields no new effects.
- Missing click/sub-id left unallocated.
- Provider out-of-order revision reconciled by source version/time.
- Unexpected currency/status enters exception not ledger.
- Malformed row isolated from batch.

**Conformance acceptance**

- Same batch 3x => one normalized transaction and financial effect.
- No click attribution guessed.
- Foreign publisher cannot read conversion.
- Parser drift reported.
- Late conversion recognized by correct event time.

### UC16 — Process commission approval, share split and reversal

- **Primary actor:** Finance service.
- **Suggested UI navigation:** `/admin/conversions/exceptions`, `/reports/earnings`, `/finance/statements`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/reports/earnings`, `GET /v1/admin/conversions/exceptions`. *(nonbinding)*
- **Conceptual records:** `conversions`, `conversion_adjustments`, `share_rules`, `commission_splits`, `ledger_accounts`, `ledger_journals`, `ledger_postings`.

**Nominal interaction sequence**

1. On authoritative approved event verify agreed finance recognition criteria.
2. Select effective-dated share_rules at conversion occurrence time; store immutable ppm snapshot.
3. Compute gross publisher/platform integer minor amounts with deterministic rounding remainder policy.
4. Finance writer posts atomic balanced journal debiting network receivable, crediting publisher payable and platform revenue.
5. On adjusted/reversed event create new signed adjustment split and offset journal linked to original.
6. Publisher UI shows original and adjustment line items, not silent overwrite.

**Failure and recovery behavior**

- Unknown currency exponent rejected.
- Rate overlap prevented by exclusion constraint.
- Pending does not post receivable.
- Negative publisher liability after payout becomes receivable/hold, never delete history.
- Two consumers cannot post same source_version.

**Conformance acceptance**

- 100 USD gross split 75 USD publisher, 25 USD platform under default 25 percent fee.
- 20 USD reversal produces -15/-5 effect.
- Duplicate event leaves one journal.
- All journal debit/credit sums equal per currency.
- Historical rate changes do not alter old split.

### UC17 — Reconcile upstream settlement receipts and clear publisher funds

- **Primary actor:** Finance operator.
- **Suggested UI navigation:** `/admin/settlements`, `/admin/settlements/import`, `/finance/balance`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/admin/settlements/import`, `GET /v1/admin/settlements`, `GET /v1/balances`. *(nonbinding)*
- **Conceptual records:** `settlement_receipts`, `settlement_allocations`, `reconciliation_exceptions`, `ledger_journals`, `ledger_postings`, `publisher_balances`.

**Nominal interaction sequence**

1. Import actual network remittance/settlement statement with source digest.
2. Match receipt against network, currency and known approved transaction balances.
3. Lock receipt and conversion allocations; prohibit allocation.
4. remaining receipt or conversion amount.
5. Post cash receipt and receivable clearing journals using finance writer.
6. Recompute available funded liability per publisher/currency minus holds and in-flight.
7. Admin resolves unmatched differences before clearing; publisher balance shows estimated vs settled vs available.

**Failure and recovery behavior**

- No bank evidence -> not payable.
- Partial payment allocates partially without overdraw.
- Different currency cannot be netted.
- Double upload leaves one receipt.
- Unmatched difference stays in exception asynchronous delivery mechanism.

**Conformance acceptance**

- Every cleared publisher amount traces to receipt ID.
- 80 USD received for 100 USD approved caps payable proportionally or per documented allocation.
- Concurrent allocators never exceed receipt.
- Zero unexplained reconciliation variance at gate.

### UC18 — Add payout method and confirm provider eligibility

- **Primary actor:** Publisher finance user.
- **Suggested UI navigation:** `/finance/payout-methods`, `/finance/payout-methods/new`, `/finance/balance`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/payout-methods`, `POST /v1/payout-methods`, `DELETE /v1/payout-methods/{id}`. *(nonbinding)*
- **Conceptual records:** `publisher_kyb`, `payout_methods`, `publishers`, `audit_logs`.

**Nominal interaction sequence**

1. Finance user selects supported country/currency/provider.
2. Browser opens tokenized provider onboarding (no raw bank data through Moneytrap).
3. Provider returns opaque account token.
4. API verifies publisher KYB + country/currency support and stores provider_account_ref.
5. UI shows pending/verified or rejected provider status.
6. Deleting in-use method forbidden until transfers terminal.

**Failure and recovery behavior**

- Unsupported country blocked.
- Malformed provider token rejected.
- Other publisher method ID 404.
- Provider verification pending disables payout.

**Conformance acceptance**

- No bank number in network logs/persistent state.
- Verified provider callback scoped to correct publisher.
- Payout with foreign method blocked.
- Failed status can be retried safely.

### UC19 — Prepare, approve, send and reconcile publisher payouts

- **Primary actor:** Finance maker and checker.
- **Suggested UI navigation:** `/admin/payout-batches`, `/admin/payout-batches/new`, `/admin/payout-batches/[id]`, `/finance/payouts`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/admin/payout-batches`, `POST /v1/admin/payout-batches/{id}/approve`, `POST /v1/admin/payout-batches/{id}/release`, `GET /v1/payouts`. *(nonbinding)*
- **Conceptual records:** `payout_batches`, `payouts`, `payout_attempts`, `publisher_balances`, `payout_holds`, `ledger_journals`, `ledger_postings`.

**Nominal interaction sequence**

1. Maker selects settled eligible balances and checks default USD50 equivalent threshold/country risk gates.
2. atomic state change locks currency balances and reserves payout amount.
3. Creates draft batch and payout instructions with unique idempotency key.
4. Another authorized MFA-verified person approves batch after reviewing evidence.
5. Release background processor calls provider using stable key.
6. Provider success/failed/unknown callbacks update payout_attempts and journal clearing.
7. On timeout reconcile provider status before retry.
8. Publisher sees pending/processing/paid/failed with receipt and statement reconciliation.

**Failure and recovery behavior**

- Same person approval denied 409.
- Unknown provider result must not be resent with fresh key.
- Available balance insufficient -> no batch.
- No KYB or payout route -> hold.
- Negative or reserved funds never transferred.

**Conformance acceptance**

- Two concurrent batches cannot spend same amount.
- Maker!=checker enforced persistent state and service.
- Provider timeout + callback does not duplicate transfer.
- Paid amount equals posted clearing and provider receipt.
- Failed transfer releases reservation once.

### UC20 — Generate statements and immutable earnings reports

- **Primary actor:** Publisher finance owner.
- **Suggested UI navigation:** `/finance/statements`, `/finance/statements/[id]`, `/reports/earnings`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/statements`, `GET /v1/statements/{id}/download`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`. *(nonbinding)*
- **Conceptual records:** `statements`, `commission_splits`, `ledger_postings`, `conversions`, `scheduled_exports`.

**Nominal interaction sequence**

1. Publisher selects reporting period and currency.
2. API builds income lines from canonical conversion and journal sources, separates pending, approved, cleared, available, paid.
3. Worker renders immutable versioned statement CSV/PDF and stores encrypted object.
4. API issues short-lived owner-scoped download URL.
5. Late adjustments produce revision or adjustment statement with referenced original.
6. UI shows stale network sync warning and effective money semantics.

**Failure and recovery behavior**

- Cross-currency arithmetic prohibited.
- URL expires.
- Pending not labeled payable.
- Incorrect rounding flagged.
- Large exports streamed async without HTTP timeout.

**Conformance acceptance**

- Period sums match ledger in minor units.
- Reversal reference visible.
- Signed URL scoped and expires.
- Source event timestamps and reporting as_of shown.

### UC21 — Create, scope, rotate and revoke API credentials

- **Primary actor:** Developer user.
- **Suggested UI navigation:** `/developers/api-keys`, `/developers/api-keys/new`, `/developers/api-keys/[id]`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/api-keys`, `POST /v1/api-keys`, `POST /v1/api-keys/{id}/rotate`, `DELETE /v1/api-keys/{id}`. *(nonbinding)*
- **Conceptual records:** `api_keys`, `organizations`, `properties`, `audit_logs`.

**Nominal interaction sequence**

1. Org owner enters key name, property scope, minimal permissions and expiry.
2. API authorizes scopes and makes crypto random secret, stores prefix+hash only.
3. UI displays secret exactly once with copy warning.
4. integration package uses bearer token and server checks org/property scopes.
5. Rotate creates replacement and documented short overlap.
6. Revoke immediately rejects key and records audit metadata.

**Failure and recovery behavior**

- Secrets never appear in list response.
- Browser script cannot use server secret.
- Expired/revoked key 401.
- Over-scoped request 403.
- Different org key inaccessible.

**Conformance acceptance**

- Plaintext secret exists only create response.
- Rotation overlap expiry tested.
- Least-privilege denied scopes.
- All endpoints inspect organization context.

### UC22 — Configure signed webhooks with test delivery and retries

- **Primary actor:** Developer user.
- **Suggested UI navigation:** `/developers/webhooks`, `/developers/webhooks/new`, `/developers/webhooks/[id]/deliveries`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/webhooks`, `PATCH /v1/webhooks/{id}`, `GET /v1/webhooks/{id}/deliveries`, `POST /v1/webhooks/{id}/test`, `POST /v1/webhooks/{id}/rotate-secret`. *(nonbinding)*
- **Conceptual records:** `webhook_endpoints`, `webhook_deliveries`, `outbox_events`, `job_failures`.

**Nominal interaction sequence**

1. Owner saves HTTPS callback and event filters.
2. Service checks syntax and DNS/IP allowlist, creates vault-held signing secret shown once.
3. Verification request proves reachable endpoint.
4. Delivery record event fans out once per subscribed endpoint.
5. Worker signs raw JSON with timestamp and HMAC-SHA256, attempts delivery, records HTTP code and duration.
6. Retry 5xx/timeout with capped exponential delay, DLQ after max attempts.
7. Developer UI can inspect redacted history, rotate secret and trigger sandbox test.

**Failure and recovery behavior**

- initial page renderingF via DNS rebinding blocked at actual connect.
- Redirect to private address blocked.
- HTTP URLs denied.
- Duplicate event keeps one logical delivery.
- Consumer replay nonce/time docs supplied.

**Conformance acceptance**

- Client verifies signature + timestamp.
- At least once delivery documented.
- Retries do not create duplicate logical event.
- Secret not logged.
- 2xx terminal.
- DLQ replay available.

### UC23 — Serve performance reports, filters and paginated APIs

- **Primary actor:** Publisher analyst.
- **Suggested UI navigation:** `/dashboard`, `/reports/clicks`, `/reports/conversions`, `/reports/earnings`, `/reports/exports`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/reports/clicks`, `GET /v1/reports/conversions`, `GET /v1/reports/earnings`, `POST /v1/reports/exports`. *(nonbinding)*
- **Conceptual records:** `conversions`, `commission_splits`, `ledger_postings`, `click_events`, `scheduled_exports`.

**Nominal interaction sequence**

1. Publisher chooses property, UTC window, timezone display and reporting category.
2. UI uses schema-typed API client with cursor paging, retry on safe GET.
3. Analytics reads analytical view qualified clicks and canonical conversions by event time.
4. Earnings reads finance source of truth, separates available from pending.
5. API returns source freshness and request_id.
6. CSV export job executes filtered, tenant-safe server query.
7. UI handles empty, stale, error and partial data without false zero earnings.

**Failure and recovery behavior**

- No leakage across tenant filters or cursors.
- Large date range asynchronously exported.
- analytical view unavailable shows unknown/stale not falsely $0.
- Currency separation maintained.

**Conformance acceptance**

- API schema contract passes.
- p95 simple reads <500ms defined workload.
- 100 max page size.
- Fuzz filters produce bounded query costs.
- Console shows source freshness and monetary states.

### UC24 — Review click fraud, suspend and resolve appeals

- **Primary actor:** Risk analyst and publisher.
- **Suggested UI navigation:** `/admin/risk`, `/admin/risk/[id]`, `/settings/compliance/appeals`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/admin/risk-flags`, `POST /v1/admin/risk-flags/{id}/decision`, `POST /v1/admin/kill-switch`. *(nonbinding)*
- **Conceptual records:** `risk_flags`, `risk_appeals`, `properties`, `links`, `payout_holds`, `audit_logs`.

**Nominal interaction sequence**

1. Risk background processor detects configurable traffic burst/bot/reversal anomalies.
2. Creates evidence-linked risk flag with severity and policy version.
3. Analyst reviews traffic and decides hold, warn, suspend, or dismiss.
4. Severe suspension updates property/link policy generation and payout hold independently.
5. Publisher sees reason and can submit appeal.
6. Reviewer logs resolution, lift holds only through authorized finance path.

**Failure and recovery behavior**

- False positives never silently delete valid commission.
- Kill switch must propagate <=60s.
- User cannot dismiss own risk flag.
- Abuse signal cannot be based solely on unreliable geo/referrer.

**Conformance acceptance**

- Each suspension traceable to evidence.
- Appeals audit retained.
- Risk hold not double-reserved.
- Revoked route fails closed.
- Reversal spikes tracked separately from click bot spikes.

### UC25 — Handle privacy requests, consent and data retention

- **Primary actor:** Privacy officer and publisher.
- **Suggested UI navigation:** `/settings/privacy`, `/admin/privacy-requests`, `/settings/compliance`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/admin/privacy-requests`, `POST /v1/admin/privacy-requests/{id}/resolve`. *(nonbinding)*
- **Conceptual records:** `privacy_requests`, `consent_configs`, `audit_logs`, `click_attributions`, `notification_deliveries`.

**Nominal interaction sequence**

1. Publisher configures country-aware consent mode and receives integration disclosure instructions.
2. Privacy officer records access/export/delete request with verified subject proof.
3. System identifies raw click and account personal data separately from legally retained finance journal.
4. Worker exports or deletes/pseudonymizes eligible data with retention lock checks.
5. API marks resolution and evidence reference; requester receives completion notice.
6. Audit records who accessed which data and why.

**Failure and recovery behavior**

- Unverified subject gets no data.
- Legal preservation exception does not erase ledger evidence.
- Missing lawful basis disables optional tracking.
- Deadline escalation alerts operator.

**Conformance acceptance**

- No visitor email in sub-ID.
- Privacy request export correctly scoped.
- Click retention job removes expired events.
- Financial records retained only per legal schedule.
- CMP absent nonessential tracking off.

### UC26 — Install website JavaScript integration package and activate Opt-in Optimize

- **Primary actor:** Website publisher.
- **Suggested UI navigation:** `/optimize`, `/optimize/install`, `/optimize/rules`, `/properties/[id]/integration`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/optimize/installations`, `GET /v1/optimize/config/{public_key}`, `POST /v1/optimize/resolve-batch`, `POST /v1/optimize/installations/{id}/disable`. *(nonbinding)*
- **Conceptual records:** `sdk_installations`, `properties`, `consent_configs`, `monetization_rules`, `links`, `link_routes`.

**Nominal interaction sequence**

1. Owner opts in approved website property and registers allowed origins.
2. UI renders copy/paste public script snippet (no API secret) with CSP docs.
3. Script loads async, checks mode/consent and scans allowed anchors, skips existing tracked links and excluded DOM.
4. integration package batches <=50 eligible link URLs and calls resolve-batch.
5. Server checks normalized host, property enabled, terms and consent before returning route.
6. integration package changes href only for allowed links; documents rel=sponsored and disclosure requirements.
7. SPA MutationObserver uses debounce and idempotent element markers; destroy/disable restores original href.

**Failure and recovery behavior**

- Unapproved origin gets safe no-op.
- Offline API leaves original links untouched.
- Repeated DOM scans do not double rewrite.
- Suspended property kill switch disables decisions.
- Existing affiliate link not overwritten.

**Conformance acceptance**

- No credentials in JS bundle.
- Existing affiliate tags untouched.
- Page remains functional when integration package fails.
- origin/CSP tests.
- <=20KB gzip target measurable.
- No per-anchor blocking network round trip.

### UC27 — Enforce CMP consent and publisher exclusions during link rewriting

- **Primary actor:** Website publisher and visitor.
- **Suggested UI navigation:** `/optimize/consent`, `/optimize/rules`, `/properties/[id]/integration`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/optimize/rules`, `PUT /v1/optimize/rules`, `GET /v1/optimize/config/{public_key}`. *(nonbinding)*
- **Conceptual records:** `consent_configs`, `monetization_rules`, `sdk_installations`, `outbox_events`.

**Nominal interaction sequence**

1. Publisher chooses strict non-tracking default and CMP integration.
2. UI creates per-property inclusion/exclusion selectors, merchant blocks and consent policy version.
3. authorized state transition validates rules and expected version, emits invalidation.
4. integration package reads live CMP state and only changes permitted links under policy.
5. Consent withdrawal runs destroy or restores prior href and stops optional tracking.
6. UI offers preview/test mode with reason codes.

**Failure and recovery behavior**

- No CMP event means deny nonessential processing.
- Conflicting selectors resolved deny-first.
- Stale policy version 409.
- UGC/comments/auth forms skipped.
- Consent withdrawal clears integration package caches.

**Conformance acceptance**

- No unconsented nonessential storage.
- No orphaned rewritten links on opt-out.
- Rule updates <=60s.
- Document and test consent across supported jurisdictions and CSP.

### UC28 — Optimize route selection with explainability and holdout

- **Primary actor:** Publisher analyst.
- **Suggested UI navigation:** `/optimize/experiments`, `/optimize/experiments/[id]`, `/optimize/decisions`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/optimize/experiments`, `GET /v1/optimize/decisions`, `POST /v1/optimize/resolve-batch`. *(nonbinding)*
- **Conceptual records:** `experiments`, `route_decisions`, `link_routes`, `program_eligibility`, `conversions`, `click_events`.

**Nominal interaction sequence**

1. For approved eligible URL, hard filter country/channel/program/network eligibility and publisher exclusions.
2. Compute route metrics from qualified clicks, approved/reversed commission and latency in observation window.
3. Use minimum 100 qualified clicks/route over 30d or flagged conservative prior.
4. Calculate explainable score eCPC 60%, reliability 20%, approval/reversal 15%, latency 5% as proposed policy.
5. Assign 10% deterministic link-level holdout where experiment authorized.
6. Return reason_code, route_id, policy_version and sample_count.
7. Dashboard compares treatment/holdout without peeking-bias claims.

**Failure and recovery behavior**

- Insufficient data chooses default instead of fabricated eCPC.
- Restricted route never chosen despite higher commission.
- Disabled experiment returns safe default.
- FX comparison uses normalized recorded basis only.

**Conformance acceptance**

- Candidate deny-first tests.
- Stable deterministic holdout.
- Score reproducible from metrics snapshot.
- Manual override audited.
- Old policy revision still attributable.

### UC29 — Ship admin operations dashboards, alerts, restore and incident workflow

- **Primary actor:** On-call engineer.
- **Suggested UI navigation:** `/admin/operations`, `/admin/operations/queues`, `/admin/operations/network-health`, `/admin/audit`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/admin/integrations`, `GET /v1/admin/audit-logs`, `POST /internal/v1/jobs/replay`, `GET /internal/health/ready`. *(nonbinding)*
- **Conceptual records:** `network_sync_cursors`, `job_failures`, `inbox_processed_events`, `audit_logs`, `feature_flags`.

**Nominal interaction sequence**

1. Instrument each request with trace_id/request_id; dashboards show redirect latency, asynchronous delivery mechanism lag, import freshness, unmatched receipt counts and journal imbalance.
2. Alert rules page on sustained threshold breaches, route revocation failure or unauthorized integration.
3. Operator identifies dead-letter failure and performs dry-run then controlled replay.
4. Restore drill reconstructs operational state from encrypted backup and replays durable events.
5. Publish runbook with incident classification and reversible kill switch.

**Failure and recovery behavior**

- Delivery record publication outage alerts.
- Replay job cannot create duplicate journal.
- Backup restore validation checks ledger totals.
- Alert test does not page customers without gating.

**Conformance acceptance**

- Trace can follow link->click->conversion->journal.
- Queues recover with no duplicate money.
- Document RTO/RPO measured.
- SLO error budget visible.
- Kill switch works during network adapter outage.

### UC30 — Activate country/channel and execute controlled launch gates

- **Primary actor:** Launch operator.
- **Suggested UI navigation:** `/admin/launch`, `/admin/integrations`, `/admin/properties`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/admin/kill-switch`, `GET /v1/admin/integrations`, `GET /internal/health/ready`. *(nonbinding)*
- **Conceptual records:** `country_activations`, `network_partnerships`, `feature_flags`, `properties`, `program_eligibility`, `audit_logs`.

**Nominal interaction sequence**

1. Commercial team confirms written network permission, settlement support, tax and disclosure for selected country/channel.
2. Admin stores evidence refs and independent approval.
3. Country activation remains disabled until all gates satisfied.
4. Canary enables approved publisher cohort behind feature flag.
5. Synthetic click verifies legal route and report ingestion.
6. Monitor latency, network error and payout ledger gates.
7. Expand cohort or rollback to nonmonetized fallback/deny within 60s.

**Failure and recovery behavior**

- Missing payout provider route cannot be advertised as payable.
- Expired contract disallows country activation.
- Rollback does not delete conversion or financial history.
- Unsupported channel never enabled.

**Conformance acceptance**

- All launch gates have evidence references.
- 0 unauthorized routes in synthetic tests.
- Rollback <=60s.
- Canary held until go/no-go signed.

### UC31 — Create approved product feed and coupon publication pipeline

- **Primary actor:** Publisher commerce editor.
- **Suggested UI navigation:** `/commerce/feeds`, `/commerce/coupons`, `/commerce/products`. *(aliases only)*
- **Suggested API bindings:** `GET /v1/programs`, `GET /v1/advertisers`. *(nonbinding)*
- **Conceptual records:** `programs`, `advertisers`, `program_eligibility`, `network_import_batches`.

**Nominal interaction sequence**

1. Commercial team obtains explicit rights for merchant product/coupon feeds.
2. Adapter capability matrix records license, refresh frequency, supported countries and attribution rules.
3. Ingest validated feed into isolated extension read model after schema approval.
4. Publisher filters available deals and sees source timestamp/expiry.
5. Expired or unapproved feed entries never rendered as active coupon.

**Failure and recovery behavior**

- Rights missing means research-only.
- Stale deal removed.
- Coupon attribution not invented.
- Cross-border terms respected.

**Conformance acceptance**

- Prototype uses licensed fixture and business approval.
- Feed invalidation tested.
- No publisher-owned coupon scraping.
- Dedicated data tables must be formally designed before production.

### UC32 — Invite and support social creators and mobile/API publishers

- **Primary actor:** Social creator/mobile developer.
- **Suggested UI navigation:** `/properties/new`, `/properties/[id]/verify`, `/links/new`, `/developers/api-keys`. *(aliases only)*
- **Suggested API bindings:** `POST /v1/properties`, `POST /v1/properties/{id}/submit`, `POST /v1/links`, `POST /v1/api-keys`. *(nonbinding)*
- **Conceptual records:** `properties`, `property_approval_reviews`, `links`, `api_keys`, `network_publishers`.

**Nominal interaction sequence**

1. Creator submits a social profile URL or app store identifier and promotion channel.
2. System canonicalizes platform handle/app bundle and routes to appropriate manual verification.
3. Reviewer checks content/category, traffic terms and any platform restrictions.
4. On approval creator builds compliant short monetized URL for bio/video or developer creates property-scoped server API key.
5. Reporting labels property channel and allowed attribution scope.
6. Suspected forbidden traffic triggers risk review.

**Failure and recovery behavior**

- Cannot pretend domain DNS verifies a social account.
- Unauthorized mobile in-app redirect blocked.
- API secret never embedded in mobile app binary.
- Self-disclosed and linked destination transparency enforced.

**Conformance acceptance**

- Creator and mobile property approval required before monetization.
- Tracking URL only for eligible channel.
- API-only clients have least-privilege key.
- Preview visible in UI.

## Implementation-independence checks for scenarios

When reviewing each scenario, replace references to "insert a table row", "call framework helper", "start a job", or "navigate to this exact URL" with the observable condition those steps achieve. Implementations may use those mechanisms, but they are not part of this agreement. The acceptance conditions and domain transitions remain normative.
