# Test Plan — Wave 4: Network connector, catalog, eligibility

**Scope:** WP-4.1 to WP-4.12 · **Milestone:** M3 · **Plan index:** [README](README.md)
**Test IDs:** `TP-W4-###`
**Conformance focus:** CT-009, CT-010 (eligibility half), CT-015

## 1. Objective

Catalog data from a network is versioned, quarantined when malformed, and never silently approves a program. Eligibility is a pure, explainable decision where unknown means deny.

## 2. Entry criteria

- Wave 3 gate passed (approved publisher and property exist).
- Network simulator (WP-4.2) built; contract suite defined.
- Partner decision (Project plan Q1) recorded: Rakuten Advertising, ADR-013.

## 3. Test matrix

### 3.1 Connector contract (run against simulator and real adapter)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W4-001 | Validate connection, valid credentials | Capability profile returned | WP-4.1 |
| TP-W4-002 | Validate connection, disabled credential | `not_authorized`; no catalog change | WP-4.7, CT-009 |
| TP-W4-003 | Capability `unsupported` for adjustments | Reported; dependent features show unavailable state | WP-4.1 |
| TP-W4-004 | Capability `temporarily_unavailable` | Sync retries with bounded backoff; not treated as empty | WP-4.1 |
| TP-W4-005 | Discover advertisers pagination | All pages consumed; freshness watermark stored | WP-4.6 |
| TP-W4-006 | Discover programs with terms and countries | Normalized with source IDs and revisions | WP-4.5 |
| TP-W4-007 | Secrets never in responses or logs | Scan of responses and logs finds none | WP-4.4 |
| TP-W4-033 | Register account with adapter-declared typed credentials | Adapter-owned schema validates required fields; client schema injection and undeclared keys are rejected before sealing or persistence; values sealed at rest; response contains only account metadata/status | WP-4.4a, API-111 |
| TP-W4-034 | Register/rotate with the global ops authorization boundary | Better Auth global admins can register/rotate; tenant owners/admins and ordinary users receive `403`; denied requests do not mutate accounts or echo/log submitted credentials | WP-4.4a, API-111, API-112 |
| TP-W4-035 | Rotate account credentials | Atomic replacement and audit event; response/logs contain no old or new values | WP-4.4a, API-112 |
| TP-W4-036 | Read account or inspect credential status | Safe metadata/status only; no credential field/value in any read response | WP-4.4a |
| TP-W4-037 | Test connection and run sync from a stored account | API test and normal catalog worker load the selected stored account, open it only in memory, construct the adapter using `account_ref`, and return/store no credential value in any response, error, diagnostic, or log | WP-4.4a, API-113 |
| TP-W4-038 | Rakuten ordinary validation and worker construction without `web_security_token` | Validation and normal worker connector construction use only `clientId`/`clientSecret`; the optional token is neither required nor passed | WP-4.4a, API-113 |
| TP-W4-039 | Store optional Advanced Reports token; missing-token report behavior | WP-4.4a seals and never exposes/logs the optional field, and ordinary validation works without it; WP-4.3a/OZE-3274 tests that an Advanced Reports call without it reports not configured/unavailable | WP-4.4a, WP-4.3a, OZE-3274 |
| TP-W4-040 | Advanced Reports with sealed `web_security_token` | WP-4.4a proves the token is sealed and not exposed; WP-4.3a/OZE-3274 sends it only to Advanced Reports reports 1, 2/22, and 3/23 and verifies no response, error, diagnostic, or log contains it or derived auth material | WP-4.4a, WP-4.3a, OZE-3274 |
| TP-W4-041 | Foreign or unsupported currency in a Rakuten Events response | WP-4.3a/OZE-3274 preserves and reports the original Events response row and amount/currency with an explicit safe no-loss outcome; it is never silently discarded, incorrectly converted, or applied as a settlement mutation | WP-4.3a, OZE-3274 |
| TP-W4-042 | Unsigned Rakuten Postback notification | WP-4.3a/OZE-3274 treats origin verification as unavailable, reports Postback unsupported, rejects the unsigned notification, and proves no state mutation or audit event occurs | WP-4.3a, OZE-3274 |
| TP-W4-043 | Deterministic per-endpoint Rakuten API pacing | WP-4.3a/OZE-3274 uses a fake clock to prove Events calls are bounded to 100/minute and Advanced Reports calls to 500/day independently; the Events quota is never applied to Advanced Reports, and calls beyond each endpoint quota wait/reject safely without exceeding its limit | WP-4.3a, OZE-3274; [Rakuten Events](https://developers.rakutenadvertising.com/guides/events); [Rakuten Advanced Reports](https://developers.rakutenadvertising.com/guides/advanced_reports) |
| TP-W4-044 | Real Rakuten program channels and eligibility text absent | Rakuten responses do not provide usable program channel or eligibility text; normalized `channels` remains empty and eligibility remains unknown-deny, without inferring support from simulator-only TP-W4-006 facts | WP-4.3a, OZE-3274 |
| TP-W4-045 | Standalone adjustments and Advanced Reports report 23 status | `list_adjustments` remains `unsupported`; adjusted commission/payment status from report 23 is represented only as settlement evidence, never retroactive Events or a standalone adjustments capability | WP-4.3a, OZE-3274 |
| TP-W4-046 | Live-only offers, deep links, and Events smoke coverage | Run live smoke coverage when account data is available; if offers, deep links, or Events rows remain unavailable, keep the external smoke gap tracked under WP-4.3 and do not claim live coverage | WP-4.3a, WP-4.3, OZE-3274 |

### 3.2 Catalog sync and quarantine

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W4-008 | Sync same payload twice | Second run creates no new revisions | WP-4.5 |
| TP-W4-009 | Sync payload with changed commission | New revision; previous kept | WP-4.5 |
| TP-W4-010 | Malformed program record (missing ID) | Quarantined; no program created; alert emitted | WP-4.6, CT-015 |
| TP-W4-011 | Unknown payload field | Ignored and counted; record accepted | WP-4.6 |
| TP-W4-012 | Program previously approved, sync now shows pending | Status not newly approved; prior approval not extended | WP-4.7, CT-009 |
| TP-W4-013 | Sync interrupted mid-cursor | Resumes from last cursor; no duplicate revisions | WP-4.6 |
| TP-W4-014 | Watermark older than policy | Catalog marked `data_stale` | WP-4.6 |

### 3.3 Eligibility (pure domain, then persistence)

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W4-015 | Program allows property country and channel, approved | `allow` with evidence | WP-4.8 |
| TP-W4-016 | Program does not allow property country | `deny` reason `geography` | WP-4.8 |
| TP-W4-017 | Channel not in program list | `deny` reason `channel` | WP-4.8 |
| TP-W4-018 | Program approval unknown | `deny` reason `unknown` | WP-4.8 |
| TP-W4-019 | Property not approved | `deny` reason `property_not_approved` | WP-4.8 |
| TP-W4-020 | Consent missing where required (Optimize flag off) | Not evaluated in M3; flag ignored | WP-4.8 |
| TP-W4-021 | Property-based: any combination of inputs | Result is `allow` only when every rule passes | WP-4.8 |
| TP-W4-022 | Decision persisted with policy version | Re-evaluating under new policy adds decision; old kept | WP-4.9 |
| TP-W4-023 | Same inputs twice | Identical decision; no duplicate row | WP-4.9 |

### 3.4 Program approval request

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W4-024 | Request approval for program | Status `requested`; not approved | WP-4.10 |
| TP-W4-025 | Network reports approval | Status `approved` only via sync | WP-4.10 |
| TP-W4-026 | Publisher tries to set approved directly | No route; guard rejects; action not reachable | WP-4.10 |

### 3.5 UI and E2E

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W4-027 | Merchant directory search with no results | Empty state with clear next step | WP-4.11 |
| TP-W4-028 | Program terms show decision reasons | Reason text matches decision | WP-4.11 |
| TP-W4-029 | Network status shows `temporarily_unavailable` | Badge and explanation; not shown as error | WP-4.11 |
| TP-W4-030 | Admin sees credential status, not credential value | Value never rendered | WP-4.11 |
| TP-W4-031 | Directory with 2,000 programs | Paginated; keyboard reachable filters | WP-4.11 |

### 3.6 Conformance

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W4-032 | CT-009, CT-010 (eligibility part), CT-015 against simulator | Green | WP-4.12 |

## 4. Exit criteria

- Contract suite green on simulator; real Rakuten adapter (ADR-013) passes the same suite. If the Rakuten sandbox cannot support the suite, scope falls back to the simulator, and a new network decision is recorded in a follow-up ADR (ADR-013 Fallback).
- Seven simulated days of sync: no silent approvals; every malformed payload quarantined (Project plan M3 gate).
- Eligibility property tests green with at least 10,000 generated cases per run.

## 5. Test data

- Simulator fixtures: `clean-catalog`, `commission-change`, `malformed-records`, `disabled-credential`, `sync-interrupt`.
- Policy versions 1 and 2 with differing geography rules.

## 6. Risks

- Simulator drift from the real network. Refresh fixtures from sandbox captures when available; record capture date.
