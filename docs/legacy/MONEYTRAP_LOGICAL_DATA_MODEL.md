# Moneytrap — Logical Data Model (Storage Neutral)

**Normative semantics, nonnormative physical design.** These are **logical entities**, not required SQL tables, collections, schemas, data-model evolution steps, or services. Implementations may combine, embed, partition, materialize, denormalize, or externalize them while retaining the relationships and invariants below.

- **Identity**: opaque stable reference, not a required UUID/ULID/string encoding.
- **Exact amount**: signed precise value and currency, never a lossy float for authority.
- **Instant**: unambiguous timestamp; store or transport in any lossless format.
- **Structured value**: typed or validated object; not a mandated JSON storage column.
- **Reference**: names a logical entity or approved external subject, checked at authorization boundaries.
- **Uniqueness**: logical consistency guarantee, achievable with a unique index, transactional check, or another race-safe method.
- **Protected bytes/string**: secret or privacy-sensitive data with purpose-specific protection.

**Data ownership and scoped access** follow the domain; a global entity does not mean globally visible. Logical field names are canonical for discussion and mapping, not mandated physical column names. Fields listed as optional may still become conditionally required by lifecycle state. Every field is a domain attribute, not a required physical column.

## Shared entity rules

1. Every durable aggregate has stable identity and an owner or globally defined visibility policy.
2. Upstream source IDs are namespaced by provider; no cross-provider collisions.
3. Source-provided amounts, statuses and revisions remain separate from Moneytrap-derived states.
4. Immutable financial and audit facts are not cascaded away when a user or property closes.
5. Direct references to sensitive banking, ID-document, or key material should be minimized; use provider references where available.
6. Uniqueness must be race-safe, and update operations must guard concurrent versions where state can change.
7. Reports are materialized or computed views, not an independent financial source of truth.

## Entity inventory
### DM-001 — users

**Scope:** global.  **Behavior:** Never expose password_hash in API; use password_hash nullable for invitation-only accounts.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `email` | string | required |
| `password_hash` | string | optional |
| `email_verified_at` | instant/date | optional |
| `status` | string | required |
| `auth_version` | integer | required |
| `locale` | string | required |
| `created_at` | instant/date | required |
| `updated_at` | instant/date | required |

**Uniqueness rule:** (email).

**Allowed-state/validation rule:** status IN ('pending','active','suspended','closed').

### DM-002 — password_reset_tokens

**Scope:** global.  **Behavior:** implementation password-recovery handler semantics; hash token; TTL configurable expiration; email index from PK. Delete on successful redemption; throttle requests.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `email` | string | identity, required |
| `token_hash` | string | required |
| `created_at` | instant/date | required |

### DM-003 — auth_sessions

**Scope:** global.  **Behavior:** Optional custom session registry if default implementation session records do not meet revocation needs; store only opaque token hash.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `user_id` | identifier/reference | → users.id, required |
| `token_hash` | string | required |
| `device_label` | string | optional |
| `ip_hash` | string | optional |
| `user_agent_hash` | string | optional |
| `auth_version` | integer | required |
| `mfa_level` | integer | required |
| `expires_at` | instant/date | required |
| `revoked_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Uniqueness rule:** (token_hash).

### DM-004 — email_verification_tokens

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `user_id` | identifier/reference | → users.id, required |
| `token_hash` | string | required |
| `expires_at` | instant/date | required |
| `consumed_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Uniqueness rule:** (token_hash).

### DM-005 — mfa_factors

**Scope:** global.  **Behavior:** Encrypt additional-authentication secrets using access-controlled encryption key; recovery codes one-way hashed; secret never returned after enrollment.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `user_id` | identifier/reference | → users.id, required |
| `type` | string | required |
| `secret_ciphertext` | protected bytes | optional |
| `webauthn_credential_id` | protected bytes | optional |
| `recovery_hashes` | structured value | required |
| `confirmed_at` | instant/date | optional |
| `revoked_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Allowed-state/validation rule:** type IN ('totp','webauthn').

### DM-006 — organizations

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `name` | string | required |
| `legal_name` | string | optional |
| `country` | string | required |
| `base_currency` | string | required |
| `status` | string | required |
| `created_by` | identifier/reference | → users.id |
| `created_at` | instant/date | required |
| `updated_at` | instant/date | required |

**Allowed-state/validation rule:** status IN ('active','suspended','closed').

### DM-007 — memberships

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `user_id` | identifier/reference | → users.id, required |
| `role` | string | required |
| `status` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (organization_id,user_id).

**Allowed-state/validation rule:** role IN ('owner','admin','editor','analyst','finance','viewer').

### DM-008 — organization_invites

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `email` | string | required |
| `role` | string | required |
| `token_hash` | string | required |
| `invited_by` | identifier/reference | → users.id, required |
| `expires_at` | instant/date | required |
| `accepted_at` | instant/date | optional |
| `revoked_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Uniqueness rule:** (token_hash).

### DM-009 — publishers

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `status` | string | required |
| `risk_tier` | string | required |
| `approved_at` | instant/date | optional |
| `suspended_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Uniqueness rule:** (organization_id).

**Allowed-state/validation rule:** status IN ('draft','in_review','approved','rejected','suspended').

### DM-010 — publisher_kyb

**Scope:** publisher.  **Behavior:** No bank/card/identity document blobs in platform persistent state; refer to compliance provider secure vault.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `provider` | string | optional |
| `provider_ref` | string | optional |
| `state` | string | required |
| `reviewed_by` | identifier/reference | → users.id |
| `reviewed_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Uniqueness rule:** (publisher_id).

### DM-011 — properties

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `type` | string | required |
| `canonical_identifier` | string | required |
| `normalized_identifier` | string | required |
| `country` | string | optional |
| `channel` | string | required |
| `verification_status` | string | required |
| `approval_status` | string | required |
| `approved_at` | instant/date | optional |
| `suspended_at` | instant/date | optional |
| `created_at` | instant/date | required |
| `updated_at` | instant/date | required |

**Uniqueness rule:** (publisher_id,type,normalized_identifier).

**Allowed-state/validation rule:** type IN ('website','social','mobile_app','api').

### DM-012 — property_verifications

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `method` | string | required |
| `challenge_hash` | string | required |
| `expires_at` | instant/date | required |
| `verified_at` | instant/date | optional |
| `attempts` | integer | required |
| `created_at` | instant/date | required |

### DM-013 — property_approval_reviews

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `reviewer_id` | identifier/reference | → users.id |
| `decision` | string | required |
| `reason_code` | string | optional |
| `evidence_ref` | string | optional |
| `created_at` | instant/date | required |

### DM-014 — networks

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `code` | string | required |
| `name` | string | required |
| `capabilities` | structured value | required |
| `enabled` | boolean | required |

**Uniqueness rule:** (code).

### DM-015 — network_partnerships

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `contract_ref` | string | optional |
| `terms_version` | string | optional |
| `state` | string | required |
| `approved_at` | instant/date | optional |
| `expires_at` | instant/date | optional |
| `permitted_countries` | structured value | required |
| `permitted_channels` | structured value | required |
| `created_at` | instant/date | required |

**Allowed-state/validation rule:** state IN ('draft','pending','active','expired','suspended','revoked').

### DM-016 — network_accounts

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `account_ref` | string | required |
| `vault_secret_ref` | string | required |
| `state` | string | required |
| `last_checked_at` | instant/date | optional |

**Uniqueness rule:** (network_id,account_ref).

### DM-017 — network_publishers

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `property_id` | identifier/reference | → properties.id |
| `external_sub_id` | string | required |
| `state` | string | required |

**Uniqueness rule:** (network_id,external_sub_id).

### DM-018 — network_sync_cursors

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `account_id` | identifier/reference | → network_accounts.id, required |
| `resource` | string | required |
| `cursor` | string | optional |
| `last_success_at` | instant/date | optional |
| `last_error` | string | optional |
| `version` | integer | required |

**Uniqueness rule:** (account_id,resource).

### DM-019 — advertisers

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `name` | string | required |
| `normalized_domain` | string | required |
| `category` | string | optional |
| `state` | string | required |

**Uniqueness rule:** (normalized_domain).

### DM-020 — advertiser_domains

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `advertiser_id` | identifier/reference | → advertisers.id, required |
| `normalized_host` | string | required |
| `domain_role` | string | required |
| `verified_at` | instant/date | optional |

**Uniqueness rule:** (advertiser_id,normalized_host).

### DM-021 — network_advertisers

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `advertiser_id` | identifier/reference | → advertisers.id, required |
| `external_id` | string | required |
| `state` | string | required |

**Uniqueness rule:** (network_id,external_id).

### DM-022 — programs

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_advertiser_id` | identifier/reference | → network_advertisers.id, required |
| `external_id` | string | required |
| `name` | string | required |
| `state` | string | required |
| `deep_link_enabled` | boolean | required |
| `starts_at` | instant/date | optional |
| `ends_at` | instant/date | optional |
| `terms` | structured value | required |
| `synced_at` | instant/date | optional |

**Uniqueness rule:** (network_advertiser_id,external_id).

### DM-023 — program_eligibility

**Scope:** global.  **Behavior:** Null dimensions mean explicit all only when contract supports it; do not interpret missing row as allow.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `program_id` | identifier/reference | → programs.id, required |
| `country` | string | optional |
| `channel` | string | optional |
| `property_type` | string | optional |
| `allow` | boolean | required |
| `valid_from` | instant/date | required |
| `valid_to` | instant/date | optional |
| `terms_version` | string | optional |

### DM-024 — publisher_program_approvals

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `program_id` | identifier/reference | → programs.id, required |
| `state` | string | required |
| `granted_at` | instant/date | optional |
| `revoked_at` | instant/date | optional |

**Uniqueness rule:** (property_id,program_id).

### DM-025 — country_activations

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `country` | string | required |
| `channel` | string | required |
| `network_id` | identifier/reference | → networks.id, required |
| `enabled` | boolean | required |
| `legal_evidence_ref` | string | optional |
| `payout_evidence_ref` | string | optional |
| `approved_by` | identifier/reference | → users.id |
| `approved_at` | instant/date | optional |

**Uniqueness rule:** (country,channel,network_id).

### DM-026 — share_rules

**Scope:** publisher.  **Behavior:** Non-overlap for same scope via exclusion constraint/transactional validation; rule version immutable once used.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `program_id` | identifier/reference | → programs.id |
| `rate_ppm` | integer | required |
| `valid_from` | instant/date | required |
| `valid_to` | instant/date | optional |
| `created_at` | instant/date | required |

**Allowed-state/validation rule:** rate_ppm BETWEEN 0 AND 1000000.

### DM-027 — links

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `property_id` | identifier/reference | → properties.id, required |
| `slug` | string | required |
| `destination_url` | string | required |
| `destination_hash` | string | required |
| `status` | string | required |
| `expires_at` | instant/date | optional |
| `created_at` | instant/date | required |
| `revoked_at` | instant/date | optional |

**Uniqueness rule:** (slug).

### DM-028 — link_routes

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `link_id` | identifier/reference | → links.id, required |
| `program_id` | identifier/reference | → programs.id, required |
| `tracking_template_ref` | string | required |
| `active` | boolean | required |
| `priority` | integer | required |
| `generation` | integer | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (link_id,program_id).

### DM-029 — link_bulk_jobs

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `property_id` | identifier/reference | → properties.id, required |
| `object_ref` | string | required |
| `state` | string | required |
| `processed` | integer | required |
| `failed` | integer | required |
| `error_ref` | string | optional |
| `created_at` | instant/date | required |

### DM-030 — click_attributions

**Scope:** publisher.  **Behavior:** Minimal implementation attribution index for partner reconciliation, not raw visitor history. Retention constrained by contracts.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `click_id` | identifier/reference | required |
| `link_id` | identifier/reference | → links.id, required |
| `route_id` | identifier/reference | → link_routes.id, required |
| `network_id` | identifier/reference | → networks.id, required |
| `network_sub_id` | string | optional |
| `external_click_ref` | string | optional |
| `occurred_at` | instant/date | required |
| `expires_at` | instant/date | required |

**Uniqueness rule:** (click_id).

### DM-031 — network_import_batches

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `resource` | string | required |
| `sha256_digest` | string | required |
| `object_ref` | string | required |
| `parser_version` | string | required |
| `source_from` | instant/date | optional |
| `source_to` | instant/date | optional |
| `state` | string | required |
| `started_at` | instant/date | required |
| `finished_at` | instant/date | optional |

**Uniqueness rule:** (network_id,resource,sha256_digest).

### DM-032 — conversion_import_rows

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `batch_id` | identifier/reference | → network_import_batches.id, required |
| `external_row_ref` | string | required |
| `payload_digest` | string | required |
| `outcome` | string | required |
| `conversion_id` | identifier/reference | optional |
| `error_code` | string | optional |

**Uniqueness rule:** (batch_id,external_row_ref).

### DM-033 — conversions

**Scope:** publisher.  **Behavior:** Publisher attribution optional until proven. Never auto-assign unmatched transactions to a guessed publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `external_txn_id` | string | required |
| `external_line_id` | string | required |
| `publisher_id` | identifier/reference | → publishers.id |
| `property_id` | identifier/reference | → properties.id |
| `link_id` | identifier/reference | → links.id |
| `click_id` | identifier/reference | optional |
| `status` | string | required |
| `gross_minor` | integer | required |
| `currency` | string | required |
| `occurred_at` | instant/date | required |
| `reported_at` | instant/date | required |
| `source_version` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (network_id,external_txn_id,external_line_id).

### DM-034 — conversion_status_events

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `conversion_id` | identifier/reference | → conversions.id, required |
| `source_event_key` | string | required |
| `from_state` | string | optional |
| `to_state` | string | required |
| `source_at` | instant/date | required |
| `received_at` | instant/date | required |

**Uniqueness rule:** (conversion_id,source_event_key).

### DM-035 — conversion_adjustments

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `conversion_id` | identifier/reference | → conversions.id, required |
| `external_adjustment_id` | string | required |
| `delta_minor` | integer | required |
| `currency` | string | required |
| `reason` | string | optional |
| `reported_at` | instant/date | required |

**Uniqueness rule:** (conversion_id,external_adjustment_id).

### DM-036 — attribution_exceptions

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `conversion_id` | identifier/reference | → conversions.id, required |
| `reason` | string | required |
| `state` | string | required |
| `evidence_ref` | string | optional |
| `resolved_by` | identifier/reference | → users.id |
| `resolved_at` | instant/date | optional |

**Uniqueness rule:** (conversion_id).

### DM-037 — commission_splits

**Scope:** publisher.  **Behavior:** Signed adjustments are supported; original split immutable; unique initial vs adjustment enforced with partial indexes.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `conversion_id` | identifier/reference | → conversions.id, required |
| `adjustment_id` | identifier/reference | → conversion_adjustments.id |
| `share_rule_id` | identifier/reference | → share_rules.id, required |
| `gross_minor` | integer | required |
| `publisher_minor` | integer | required |
| `platform_minor` | integer | required |
| `currency` | string | required |
| `created_at` | instant/date | required |

**Allowed-state/validation rule:** gross_minor = publisher_minor + platform_minor.

### DM-038 — ledger_accounts

**Scope:** finance.  **Behavior:** `finance`. Global null owner requires expression index with coalesce to prevent duplicates.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `code` | string | required |
| `owner_type` | string | required |
| `owner_id` | identifier/reference | optional |
| `currency` | string | required |
| `type` | string | required |

**Uniqueness rule:** (code,owner_type,owner_id,currency).

### DM-039 — ledger_journals

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `source_type` | string | required |
| `source_id` | identifier/reference | required |
| `source_version` | string | required |
| `currency` | string | required |
| `reversal_of` | identifier/reference | → ledger_journals.id |
| `posted_at` | instant/date | required |

**Uniqueness rule:** (source_type,source_id,source_version,currency).

### DM-040 — ledger_postings

**Scope:** finance.  **Behavior:** `finance`. Transaction-posting service enforces same currency and balanced sum (constraint trigger recommended).  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `journal_id` | identifier/reference | → ledger_journals.id, required |
| `account_id` | identifier/reference | → ledger_accounts.id, required |
| `debit_minor` | integer | required |
| `credit_minor` | integer | required |

**Allowed-state/validation rule:** debit_minor >= 0, credit_minor >= 0, (debit_minor = 0) <> (credit_minor = 0).

### DM-041 — settlement_receipts

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `external_ref` | string | required |
| `gross_minor` | integer | required |
| `currency` | string | required |
| `received_at` | instant/date | required |
| `state` | string | required |
| `object_ref` | string | optional |

**Uniqueness rule:** (network_id,external_ref).

### DM-042 — settlement_allocations

**Scope:** finance.  **Behavior:** `finance`. Guard total allocated<=receipt gross and <=eligible outstanding by locking receipt and conversion rows.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `receipt_id` | identifier/reference | → settlement_receipts.id, required |
| `conversion_id` | identifier/reference | → conversions.id, required |
| `allocated_minor` | integer | required |
| `currency` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (receipt_id,conversion_id).

### DM-043 — reconciliation_exceptions

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `network_id` | identifier/reference | → networks.id, required |
| `batch_id` | identifier/reference | → network_import_batches.id |
| `receipt_id` | identifier/reference | → settlement_receipts.id |
| `reason` | string | required |
| `delta_minor` | integer | optional |
| `currency` | string | optional |
| `state` | string | required |
| `resolved_by` | identifier/reference | → users.id |
| `resolved_at` | instant/date | optional |

### DM-044 — publisher_balances

**Scope:** finance.  **Behavior:** `finance`. Materialized cache derived from journal/allocations/holds under lock, never independent source of truth.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `publisher_id` | identifier/reference | → publishers.id, required |
| `currency` | string | required |
| `cleared_minor` | integer | required |
| `held_minor` | integer | required |
| `inflight_minor` | integer | required |
| `updated_at` | instant/date | required |

**Uniqueness rule:** (publisher_id,currency).

### DM-045 — payout_holds

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `currency` | string | required |
| `amount_minor` | integer | required |
| `reason` | string | required |
| `expires_at` | instant/date | optional |
| `released_at` | instant/date | optional |
| `created_by` | identifier/reference | → users.id, required |

### DM-046 — payout_methods

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `provider` | string | required |
| `provider_account_ref` | string | required |
| `country` | string | required |
| `currency` | string | required |
| `verified_at` | instant/date | optional |
| `state` | string | required |

**Uniqueness rule:** (provider,provider_account_ref).

### DM-047 — payout_batches

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `currency` | string | required |
| `period_start` | instant/date | required |
| `period_end` | instant/date | required |
| `state` | string | required |
| `created_by` | identifier/reference | → users.id, required |
| `approved_by` | identifier/reference | → users.id |
| `approved_at` | instant/date | optional |
| `created_at` | instant/date | required |

**Allowed-state/validation rule:** approved_by IS NULL OR approved_by <> created_by.

### DM-048 — payouts

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `batch_id` | identifier/reference | → payout_batches.id, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `method_id` | identifier/reference | → payout_methods.id, required |
| `currency` | string | required |
| `amount_minor` | integer | required |
| `idempotency_key` | string | required |
| `provider_ref` | string | optional |
| `state` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (idempotency_key).

**Allowed-state/validation rule:** amount_minor > 0.

### DM-049 — payout_attempts

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `payout_id` | identifier/reference | → payouts.id, required |
| `provider_request_key` | string | required |
| `state` | string | required |
| `provider_ref` | string | optional |
| `response_digest` | string | optional |
| `attempted_at` | instant/date | required |

**Uniqueness rule:** (provider_request_key).

### DM-050 — statements

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `currency` | string | required |
| `period_start` | instant/date | required |
| `period_end` | instant/date | required |
| `revision` | integer | required |
| `totals` | structured value | required |
| `object_ref` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (publisher_id,currency,period_start,period_end,revision).

### DM-051 — fx_rates

**Scope:** finance.  **Behavior:** `finance`.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `base_currency` | string | required |
| `quote_currency` | string | required |
| `rate` | exact decimal | required |
| `source` | string | required |
| `effective_at` | instant/date | required |

**Uniqueness rule:** (base_currency,quote_currency,effective_at).

**Allowed-state/validation rule:** rate > 0.

### DM-052 — api_keys

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `property_id` | identifier/reference | → properties.id |
| `prefix` | string | required |
| `secret_hash` | string | required |
| `scopes` | structured value | required |
| `expires_at` | instant/date | optional |
| `last_used_at` | instant/date | optional |
| `revoked_at` | instant/date | optional |
| `created_by` | identifier/reference | → users.id, required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (prefix).

### DM-053 — idempotency_requests

**Scope:** organization.  **Behavior:** Same idempotency key + different payload -> 409, exact retry returns canonical response.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `scope` | string | required |
| `key_hash` | string | required |
| `request_hash` | string | required |
| `response_status` | integer | optional |
| `response_body` | structured value | optional |
| `expires_at` | instant/date | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (organization_id,scope,key_hash).

### DM-054 — webhook_endpoints

**Scope:** organization.  **Behavior:** HTTPS-only, block private DNS rebind/initial page renderingF per outgoing delivery; secrets held in vault.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `url` | string | required |
| `events` | structured value | required |
| `secret_ref` | string | required |
| `state` | string | required |
| `created_at` | instant/date | required |

### DM-055 — webhook_deliveries

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `endpoint_id` | identifier/reference | → webhook_endpoints.id, required |
| `event_id` | identifier/reference | required |
| `attempt` | integer | required |
| `status` | string | required |
| `last_http_status` | integer | optional |
| `retry_at` | instant/date | optional |
| `delivered_at` | instant/date | optional |

**Uniqueness rule:** (endpoint_id,event_id).

### DM-056 — outbox_events

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `topic` | string | required |
| `aggregate_id` | identifier/reference | required |
| `aggregate_version` | integer | required |
| `payload` | structured value | required |
| `created_at` | instant/date | required |
| `published_at` | instant/date | optional |

**Uniqueness rule:** (topic,aggregate_id,aggregate_version).

### DM-057 — inbox_processed_events

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `consumer` | string | required |
| `event_id` | identifier/reference | required |
| `processed_at` | instant/date | required |

**Uniqueness rule:** (consumer,event_id).

### DM-058 — job_failures

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `job_type` | string | required |
| `queue_name` | string | required |
| `event_id` | identifier/reference | optional |
| `error_code` | string | optional |
| `payload_ref` | string | optional |
| `attempts` | integer | required |
| `failed_at` | instant/date | required |
| `replayed_at` | instant/date | optional |

### DM-059 — audit_logs

**Scope:** global.  **Behavior:** Append-only; redact secrets, tokens, personal bank/identity data from metadata.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id |
| `actor_type` | string | required |
| `actor_id` | identifier/reference | optional |
| `action` | string | required |
| `entity_type` | string | required |
| `entity_id` | identifier/reference | required |
| `before_hash` | string | optional |
| `after_hash` | string | optional |
| `metadata` | structured value | required |
| `occurred_at` | instant/date | required |

### DM-060 — risk_flags

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `publisher_id` | identifier/reference | → publishers.id, required |
| `property_id` | identifier/reference | → properties.id |
| `link_id` | identifier/reference | → links.id |
| `rule_code` | string | required |
| `severity` | string | required |
| `state` | string | required |
| `evidence_ref` | string | optional |
| `reviewed_by` | identifier/reference | → users.id |
| `created_at` | instant/date | required |

### DM-061 — risk_appeals

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `flag_id` | identifier/reference | → risk_flags.id, required |
| `submitted_by` | identifier/reference | → users.id, required |
| `statement` | string | required |
| `evidence_ref` | string | optional |
| `state` | string | required |
| `resolved_by` | identifier/reference | → users.id |
| `created_at` | instant/date | required |

### DM-062 — consent_configs

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `mode` | string | required |
| `cmp_provider` | string | optional |
| `policy_version` | string | required |
| `updated_at` | instant/date | required |

**Uniqueness rule:** (property_id).

### DM-063 — monetization_rules

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `rule_type` | string | required |
| `pattern` | string | required |
| `action` | string | required |
| `priority` | integer | required |
| `enabled` | boolean | required |

### DM-064 — sdk_installations

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `public_key` | string | required |
| `allowed_origins` | structured value | required |
| `status` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (public_key).

### DM-065 — route_decisions

**Scope:** publisher.  **Behavior:** Sample or aggregate decisions according to retention; avoid persisting visitor identity.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `link_id` | identifier/reference | → links.id, required |
| `route_id` | identifier/reference | → link_routes.id, required |
| `policy_version` | string | required |
| `model_version` | string | optional |
| `reason_code` | string | required |
| `experiment_id` | identifier/reference | optional |
| `decided_at` | instant/date | required |

### DM-066 — experiments

**Scope:** publisher.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `property_id` | identifier/reference | → properties.id, required |
| `name` | string | required |
| `state` | string | required |
| `holdout_pct` | exact decimal | required |
| `policy_version` | string | required |
| `created_at` | instant/date | required |

**Allowed-state/validation rule:** holdout_pct BETWEEN 0 AND 100.

### DM-067 — feature_flags

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `scope_type` | string | required |
| `scope_id` | identifier/reference | optional |
| `key` | string | required |
| `value` | structured value | required |
| `version` | integer | required |

**Uniqueness rule:** (scope_type,scope_id,key).

### DM-068 — privacy_requests

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id |
| `subject_ref_hash` | string | required |
| `type` | string | required |
| `state` | string | required |
| `due_at` | instant/date | optional |
| `resolution_ref` | string | optional |
| `created_at` | instant/date | required |

### DM-069 — notification_templates

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `key` | string | required |
| `locale` | string | required |
| `version` | integer | required |
| `subject` | string | required |
| `body` | string | required |
| `enabled` | boolean | required |

**Uniqueness rule:** (key,locale,version).

### DM-070 — notification_deliveries

**Scope:** global.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `user_id` | identifier/reference | → users.id |
| `channel` | string | required |
| `template_key` | string | required |
| `provider_ref` | string | optional |
| `state` | string | required |
| `dedup_key` | string | required |
| `created_at` | instant/date | required |

**Uniqueness rule:** (dedup_key).

### DM-071 — scheduled_exports

**Scope:** organization.  

| Logical field | Semantic type | Conditions |
|---|---|---|
| `id` | identifier/reference | identity, required |
| `organization_id` | identifier/reference | → organizations.id, required |
| `type` | string | required |
| `filters` | structured value | required |
| `state` | string | required |
| `object_ref` | string | optional |
| `expires_at` | instant/date | optional |
| `created_at` | instant/date | required |

## Logical relationship and storage design checklist

- Organization–membership–user join is scope-aware. One principal may belong to multiple organizations with different privileges.
- Publisher–property is one-to-many; verification is distinct from review decision; multiple review records preserve decision history.
- A normalized advertiser may map to multiple upstream advertisers and programs; eligibility is specific to source, country, channel, property and policy version.
- A link may have multiple route candidates; each resolved click captures exactly the chosen allowed route version and time.
- Source conversion and adjustments preserve source account, ID and revision; unmatched attribution is stored as a reviewed exception, not guessed.
- Every financial journal contains at least two balancing postings in a single currency; settlement allocations cannot exceed eligible receipt amounts.
- Payout attempts reference a stable payout identity. A provider timeout retains uncertainty and the payout reserve.
- Secrets and personal information have field-level purpose, retention, access and deletion/hold policy.
- High-volume click reporting may use derived aggregates, but accounting must derive from source/ledger evidence rather than click totals.
- Any schema migration or format migration preserves old references, historical attribution, financial totals, and idempotency keys.
