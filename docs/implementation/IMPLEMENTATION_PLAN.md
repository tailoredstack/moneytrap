# Moneytrap — Concrete Implementation Plan

**Status:** Draft for review. Documents only.
**Derives from:** [Project plan](../MONEYTRAP_PROJECT_PLAN.md) (milestones M0–M9) and [Blueprint](../MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md) (stack, layout, test layers).
**Behavior source:** [Technical specification](../legacy/MONEYTRAP_TECHNICAL_SPECIFICATION_COMPLETE.md), [use cases](../legacy/MONEYTRAP_USE_CASES.md), [API catalog](../legacy/MONEYTRAP_API_OPERATIONS.md), [data model](../legacy/MONEYTRAP_LOGICAL_DATA_MODEL.md), [UI catalog](../legacy/MONEYTRAP_UI_EXPERIENCES.md), [conformance cases](../legacy/MONEYTRAP_CONFORMANCE_CASES.md). Where this file and the spec disagree, the spec wins.

Companion documents:
- [WAVES.md](WAVES.md): how work packages group into waves and parallel lanes.
- [test-plans/](../test-plans/): one test plan per wave.
- [ui/SKELETONS.md](../ui/SKELETONS.md): screen skeletons referenced by UI work packages.

---

## 1. Conventions

**Work package (WP) ID:** `WP-<wave>.<n>` with lettered children allowed for scoped decomposition, for example `WP-4.4a`. Waves are numbered as in [WAVES.md](WAVES.md).

**Lane:** a stream of work that one engineer or pair can own without blocking other lanes in the same wave. Lane letters are local to a wave (A, B, C, D, E).

**Work package fields:**
- **Spec refs:** UC (use case), API, DM (data model), UI, CT (conformance), spec § number.
- **Depends on:** WPs that must be merged first. Ports are merged before the lanes that implement them.
- **Done when:** observable completion criteria. A WP is not done until its tests in the [wave test plan](../test-plans/) are green and telemetry and audit events exist where the spec requires them (spec §13).

**Package paths** follow [Blueprint §2](../MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md#2-monorepo-layout). Short names: `domain` = `packages/domain`, `app` = `packages/application`, `pg` = `packages/adapter-postgres`, `redis` = `packages/adapter-redis`, `server` = `apps/server`, `web` = `apps/web`, `contracts` = `packages/contracts`, `kit` = `packages/test-kit`, `conf` = `packages/conformance`.

**Definition of done (every WP):**
1. Failing test written first, at the lowest layer that expresses the behavior (Blueprint §6.1).
2. Module boundaries pass `dependency-cruiser` (Blueprint §2 rules).
3. Errors use the stable codes from spec §7.1 and map through the single HTTP error table.
4. Mutating commands accept an idempotency key where the spec requires it (Blueprint §5.2).
5. Sensitive or privileged changes write an audit event (spec §4.4).
6. Linked UI screens implement loading, empty, error, permission-denied, and stale states (spec §8).

---

## 2. Wave 0 — Foundations (milestone M0)

Goal: a repo that builds, lints, tests, and produces a binary, plus the three spikes that decide the open technical risks.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-0.1 | Monorepo skeleton | A | — | root `package.json` (Bun workspaces), `apps/server`, `apps/web`, `packages/*` (empty) | Blueprint §2 | `bun install` and `bun run typecheck` pass on empty packages |
| WP-0.2 | Lint, format, boundary rules | A | 0.1 | `biome.json`, `.dependency-cruiser.cjs` | Blueprint §3 | A deliberate import from `domain` to `pg` fails CI |
| WP-0.3 | CI pipeline | A | 0.1 | `.github/workflows/ci.yml` | Blueprint §10 | Push runs typecheck, lint, boundaries, tests, binary build on macOS and Linux |
| WP-0.4 | Local infrastructure | A | — | `ops/docker-compose.yml` | Blueprint §1 | `docker compose up` gives Postgres 16 and Redis 7 with health checks |
| WP-0.5 | Spike A: binary shape | B | 0.1 | `spikes/binary/` (discarded after ADR) | Blueprint §12 | One executable serves an Elysia route, an embedded page, and runs `--migrate` on a clean machine |
| WP-0.6 | Spike B: redirect path | B | 0.1, 0.4 | `spikes/redirect/` | Blueprint §5.3, §8, §12 | Meets latency target; revocation within 5 s; 503 with both stores down |
| WP-0.7 | Spike C: library compatibility | B | 0.1 | `spikes/compat/` | Blueprint §12 | Each library passes under `bun test` and the compiled binary, or ADR records fallback |
| WP-0.8 | Accept ADR-001 … ADR-011 | C | 0.5, 0.6, 0.7 | `docs/adr/` | Blueprint §11 | Each ADR is Accepted, or Rejected with a recorded fallback and date |
| WP-0.9 | Conformance stubs | C | 0.1 | `packages/conformance/src/ct/*.test.ts` | Conformance CT-001 … CT-022 | 22 `test.todo` entries tagged with milestone |
| WP-0.10 | Load profile and SLO sign-off | C | — | `ops/load/profile.md` | Blueprint §8; plan Q5 | Product confirms latency and availability targets |

---

## 3. Wave 1 — Platform kernel

Goal: the shared pieces every feature uses: money, IDs, errors, persistence and transactions, the HTTP kernel, contracts, test doubles, and the web shell.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-1.1 | Money and currency | A | 0.8 | `domain/src/money/` (`money.ts`, `currency.ts`, `iso4217.ts`) | §5.1, §7.2; ADR-005 | Money is `bigint` minor units; cross-currency add throws `VALIDATION_FAILED`; parse rejects floats |
| WP-1.2 | Typed IDs and Clock port | A | 0.8 | `domain/src/ids/`, `app/src/ports/clock.ts`, `app/src/ports/id-generator.ts` | §4.2 | IDs carry a type prefix; no `Date.now()` outside adapters |
| WP-1.3 | Error model | A | 0.8 | `domain/src/errors/codes.ts`, `server/src/http/error-map.ts` | §7.1 | Every code in §7.1 has one HTTP mapping and one unit test |
| WP-1.4 | Migration runner | B | 0.8, 0.5 | `pg/src/migrate.ts`, `pg/src/migrations/index.ts` | ADR-003; Blueprint §1 | Migrations imported statically; `--migrate` runs them in order and is idempotent |
| WP-1.5 | Baseline tables | B | 1.4 | `pg/src/migrations/0001_platform.ts` | DM-053, DM-056, DM-057, DM-059 | Tables exist; audit role has no UPDATE/DELETE grant |
| WP-1.6 | Transaction helper and `Ctx` type | B | 1.4, 1.2 | `pg/src/transaction.ts`, `app/src/ctx.ts` | Blueprint §3.0, §5.6 | `withTx(db, fn)` rolls back on throw; `Ctx` is the only dependency bag passed to actions and queries |
| WP-1.7 | Outbox writer and relay | B | 1.5, 0.4 | `pg/src/outbox/`, `redis/src/queue.ts`, `server/src/worker/relay.ts` | Blueprint §5.4; ADR-004 | Events committed with state change; relay publishes at least once; consumer dedupe by `event_id` |
| WP-1.8 | Elysia app factory | C | 1.3, 1.9 | `server/src/app.ts`, `server/src/http/` | Blueprint §3; ADR-002 | `createApp(deps)` returns an app usable via `app.handle()`; request ID on every response |
| WP-1.9 | Shared contracts | C | 1.1 | `contracts/src/envelope.ts`, `money.ts`, `pagination.ts`, `error.ts` | §7.1, §7.2, §7 pagination | Schemas generate OpenAPI; money encodes as decimal string |
| WP-1.10 | Idempotency middleware | C | 1.5, 1.8 | `server/src/http/idempotency.ts`, `app/src/idempotency.ts` | §4.2; DM-053; Blueprint §5.2 | Same key and body returns stored response; same key and different body returns `STATE_CONFLICT` |
| WP-1.11 | Health, readiness, telemetry, redaction | C | 1.8 | `server/src/http/health.ts`, `server/src/telemetry/` | §10; Blueprint §9 | `/healthz` and `/readyz`; logger redacts token-shaped fields |
| WP-1.12 | Test kit | D | 1.2, 1.6 | `kit/src/fakes/`, `kit/src/fixtures/`, `kit/src/clock.ts` | Blueprint §6.2 | Every port in `app` has a fake; fake clock advances explicitly |
| WP-1.13 | Adapter contract harness | D | 1.12 | `kit/src/contracts/` | Blueprint §6.2 | One suite runs against fake and real adapter via a parameter |
| WP-1.14 | Web shell | D | 1.9 | `web/src/app/` (TanStack Router root, Query provider), `web/src/api/client.ts` (typed from `contracts`), `packages/ui/` (shadcn components copied in) | Blueprint §1; UI §8; ADR-010 | Router with typed search params; Query client with error boundary; shadcn Button, Input, Form, Table, Toast present; skip link; no server code imported |
| WP-1.15 | Single-binary packaging | D | 0.5, 1.14, 1.4 | `apps/server/build.ts`, `apps/server/src/assets.ts` | Blueprint §1 | `bun build --compile` output serves API, web assets, and `--migrate` |

---

## 4. Wave 2 — Identity and access (milestone M1)

Goal: sign-up through invitation, with sessions, MFA for privileged roles, and tenant isolation.

**Port-first merge point:** WP-2.2 (Better Auth config), WP-2.8 and WP-2.9 (organization model and role permissions), and WP-2.13 (Notifier port) merge before lanes B–D start. Everything below depends on these.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-2.1 | User aggregate and state machine | A | 1.1–1.3 | `domain/src/identity/user.ts` | §5 User; DM-001 | pending → active → suspended/closed; no privileged action before active |
| WP-2.2 | Better Auth setup | A | 1.4, 1.2 | `server/src/auth/config.ts`, `server/src/http/auth.ts` (mounts Better Auth handler on Elysia) | ADR-009; Blueprint §7 | Email/password, email verification, password reset, two-factor (TOTP + backup codes), organization and API key plugins enabled; Better Auth tables generated into migration `0002_better_auth.ts` (WP-2.12 owns `0003_identity.ts`); config tests assert the security settings in Blueprint §7 |
| WP-2.3 | Register and verify email | A | 2.2, 2.13 | `server/src/auth/config.ts` (email hooks), `app/src/actions/identity/` (only post-signup business setup) | UC01; API-001 to API-003; DM-004; CT-001 | Known and unknown email give the same response (Better Auth default plus test); verification link single use and expiring; verification email goes through Notifier with dedup key |
| WP-2.4 | Login, sessions, step-up | A | 2.2 | `server/src/http/guards/assurance.ts` | UC02; API-004; DM-003 | Login through Better Auth; privileged routes require a second factor within a configured window; guard returns step-up required code |
| WP-2.5 | Password recovery | A | 2.2, 2.13 | `server/src/auth/config.ts` (reset hooks) | UC03; API-008, API-009; DM-002; CT-002 to CT-004 | Reset link single use and expiring; concurrent use yields one success; other sessions revoked on reset per policy |
| WP-2.6 | MFA enrollment and recovery codes | A | 2.2 | `server/src/auth/config.ts` (twoFactor plugin), `web` MFA screens | UC04; API-013, API-014; DM-005 | Enrollment confirmed by TOTP; backup codes single use; disabling MFA requires step-up |
| WP-2.7 | Session management | A | 2.2 | Better Auth session API, thin wrapper in `server/src/http/sessions.ts` | UC04; API-006, API-010, API-011, API-012 | List and revoke sessions; password change revokes other sessions per policy; tests cover the policy only |
| WP-2.8 | Organization aggregate and creation | B | 1.1–1.3, 2.2 | `domain/src/access/organization.ts`, `app/src/access/create-org.ts`, `pg/src/access/organization-store.ts`, `pg/src/migrations/0003_organization.ts` | UC05; API-015, API-016; DM-006 | Creator becomes owner in same transaction; no client-supplied owner; Postgres store writes organization and owner membership atomically, with a rollback test that fails the membership insert after the organization insert; migration `0003_organization.ts` owns the organization and membership tables with a foreign key to Better Auth's `user` |
| WP-2.9 | Roles and permissions | B | 2.2, 2.8 | `server/src/auth/access.ts` (Better Auth organization access control statements and roles), `domain/src/access/permissions.ts` (permission names as constants) | §4.1; DM-007; UC05 | Role-to-permission map defined once with Better Auth access control; `can(principal, permission, scope)` wrapper in `domain` is a pure function over that map; permission matrix table-tested against spec API catalog |
| WP-2.10 | Invitations and memberships | B | 2.9, 2.13 | Better Auth organization plugin (invitations, members, roles); `server/src/auth/config.ts` (invitation email hook) | UC05; API-019, API-020; DM-006, DM-008; CT-008 | Invitation single use and expiring; accepting twice yields one membership; invitation email through Notifier with dedup key |
| WP-2.11 | Authorization guards and not-found rule | B | 2.9, 2.4 | `server/src/http/auth.ts` (authenticate), `server/src/http/guards/` (route permission table, scope resolvers) | §4.1; CT-005; Blueprint §3.1 | Every route declares a guard; a test fails if any route lacks one; foreign resource returns `RESOURCE_NOT_FOUND`, indistinguishable from missing |
| WP-2.12 | Identity and access schema and queries | C | 1.6, 2.1, 2.2, 2.8 | `pg/src/migrations/0003_identity.ts`, `schema/src/identity.ts`, `app/src/queries/identity/` | DM-001 to DM-008 | Migration applies cleanly; unique constraints enforced in Postgres; read queries return DTOs |
| WP-2.13 | Notifier port and adapter | C | 1.2 | `app/src/ports/notifier.ts`, `server/src/adapters/notify-dev.ts` | §6.3 | Dedup key required; dev adapter records messages for tests |
| WP-2.14 | Auth rate limiting | C | 2.2, 0.6 | `server/src/auth/config.ts` (Better Auth rate limit with Redis storage), `redis/src/rate-limit.ts` (redirect and API routes) | §4.4; Blueprint §7 | Login and recovery limited per identity and per IP; limits from policy config |
| WP-2.15 | Identity and org screens | D | 1.14, 2.4, 2.8 | `web/src/features/identity/`, `web/src/features/access/` (shadcn Form, Card, Dialog, Table; TanStack Form and Query) | UI-001, UI-003, UI-004, UI-006 to UI-009, UI-011, UI-013, UI-014 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §1 render all states; auth calls go through Better Auth client |
| WP-2.16 | Activate identity conformance | E | 2.3 to 2.11 | `packages/conformance/src/ct/identity.test.ts` | CT-001 to CT-005, CT-008 | All listed cases green against the in-process app |

---

## 5. Wave 3 — Publisher and property approval (milestone M2)

Goal: a publisher submits KYB and a website property, proves ownership, and is approved by our review team. Verification and approval are separate states.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-3.1 | Publisher aggregate and state machine | A | 2.9 | `domain/src/publisher/publisher.ts` | §5 Publisher; UC06; DM-009 | draft → submitted → in review → approved/rejected/suspended; illegal transitions rejected |
| WP-3.2 | KYB submission | A | 3.1, 2.12 | `app/src/publisher/submit-kyb.ts`, `pg/src/publisher/` | UC06; DM-010; API-022 | Stores document references only; no raw document bytes in tables or logs |
| WP-3.3 | Publisher review decision | A | 3.1, 1.10 | `app/src/publisher/decide-review.ts` | UC06; API-069, API-070; DM-013 | Decision requires reason; audit event written in the same transaction |
| WP-3.4 | Property aggregate and state machine | B | 2.9 | `domain/src/properties/property.ts` | §5 Property; DM-011 | draft → verification pending → verified → review pending → approved/rejected/suspended |
| WP-3.5 | Website verification challenge | B | 3.4 | `app/src/properties/verify.ts`, `server/src/adapters/dns-resolver.ts`, `pg/src/properties/` | UC07; API-027, API-028; DM-012 | DNS TXT or meta-tag challenge; challenge expires; rechecks are idempotent |
| WP-3.6 | Property submit and compliance decision | B | 3.4, 3.3 | `app/src/properties/submit.ts`, `app/src/properties/decide.ts` | UC08; API-029, API-030; DM-013; CT-006 | Verified property is not monetizable until approved |
| WP-3.7 | Suspend and reinstate property | B | 3.6 | `app/src/properties/suspend.ts` | UC08; CT-007 | Suspension blocks new monetization immediately; history stays readable for staff |
| WP-3.8 | Ops review queue | C | 3.3, 3.6, 2.15 | `web/src/features/ops-review/` | UI-017, UI-018, UI-023, UI-024 | Queue, decision form with reason, evidence panel |
| WP-3.9 | Audit viewer (minimal) | C | 1.5 | `app/src/operations/audit-query.ts`, `web/src/features/audit/` | UI-077; §4.4 | Shows actor, scope, reason, timestamp, object for review decisions |
| WP-3.10 | Publisher onboarding and property screens | D | 1.14, 3.2, 3.5 | `web/src/features/publisher/`, `web/src/features/properties/` | UI-005, UI-015, UI-016, UI-019 to UI-022, UI-025 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §2 render all states |
| WP-3.11 | Activate publisher conformance | E | 3.2 to 3.7 | `packages/conformance/src/ct/publisher.test.ts` | CT-006, CT-007 | Green in-process |

---

## 6. Wave 4 — Network connector, catalog, eligibility (milestone M3)

Goal: approved properties see the programs they may promote, decided by a pure eligibility function over versioned source facts. The connector is contract-first, so it can be built against a simulator before the real network is live.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-4.1 | Connector port and capability profile | A | 1.2 | `app/src/ports/network-connector.ts`, `domain/src/networks/capability.ts` | §6.1 | Each operation in §6.1 typed; capability states `unsupported`, `temporarily_unavailable`, `not_authorized` |
| WP-4.2 | Recorded-fixture network simulator | A | 4.1, 1.12 | `kit/src/network-sim/` | Conformance CT-009, CT-012, CT-015 | Deterministic transactions, adjustments, malformed payloads, disabled credential |
| WP-4.3 | Real connector adapter | A | 4.1, partner decision (Plan Q1, decided: ADR-013); Rakuten contract confirmation gates merge, not start | `packages/adapter-network-rakuten/` | §6.1; ADR-013 (supersedes ADR-012) | Passes the same adapter contract suite as the simulator |
| WP-4.3a | Rakuten connector API gaps | A | Parent: WP-4.3; Depends on: WP-4.4a (OZE-3276) | `packages/adapter-network-rakuten/` | ADR-013; TP-W4-037 to TP-W4-046; OZE-3274 | Stored-account server wiring uses WP-4.4a's TP-W4-037/038 coverage; optional sealed `web_security_token` remains unnecessary for ordinary validation and is sent only to Advanced Reports reports 1, 2/22, and 3/23, where missing-token requests return explicit unavailable/not-configured and no secret or derived auth material leaks (TP-W4-039/040). Rakuten program channel/eligibility text remains absent: normalized channels stay empty and eligibility remains unknown-deny (TP-W4-044). Standalone `list_adjustments` remains unsupported; adjusted commission/payment status from report 23 is settlement evidence only, never retroactive Events or a standalone adjustments capability (TP-W4-045). Foreign/unsupported currency returned by Events is preserved/reported as an explicit safe no-loss outcome, never silently discarded or incorrectly converted (TP-W4-041). Unsigned Postbacks remain unsupported and cannot mutate state until origin verification is available (TP-W4-042). Deterministic-clock tests enforce independent per-endpoint quotas: Events 100 requests/minute and Advanced Reports 500 requests/day, without applying the Events quota to Advanced Reports (TP-W4-043). Live offers/deep links/Events smoke runs when account data is available; otherwise the external smoke gap remains tracked under WP-4.3 and is not claimed covered (TP-W4-046). |
| WP-4.4 | Network account and credentials | A | 4.1, 1.5 | `pg/src/networks/`, `server/src/adapters/secret-box.ts` | §4.4; DM-016 | Credentials encrypted with key ID; never returned by any endpoint |
| WP-4.4a | Network account registration, credential rotation, and connection test | A | 2.2, 2.11, 4.3, 4.4 | `app/src/networks/`, `adapter-network-rakuten/`, `server/src/auth/`, `server/src/http/`, `server/src/worker/`, `pg/src/migrations/0024_better_auth_admin.ts`, `pg/src/migrations/index.ts` | API-111 to API-113; TP-W4-033 to TP-W4-040; ADR-013 | Adapter-declared typed credential fields are sealed per account; register/rotate routes require Better Auth's global admin role for `admin:ops` (distinct from tenant organization roles) and return safe account metadata; test-connection returns the adapter capability profile; network workers load and decrypt the selected stored account and construct its connector without exposing credentials. Optional `web_security_token` is an adapter-declared sealed field and never appears in reads, responses, errors, diagnostics, or logs; ordinary API-113 validation and worker connector construction use only `clientId`/`clientSecret` and do not require or pass this token. Advanced Reports CSV settlement evidence for reportid 1, 2/22, and 3/23 remains unsupported in WP-4.4a and is owned by OZE-3274 after this package stores the token; TP-W4-039/040 distinguish token storage/non-leak and ordinary validation from OZE-3274 report behavior with and without the token. |
| WP-4.5 | Advertiser and program source facts | B | 4.1, 1.5 | `domain/src/catalog/`, `pg/src/catalog/`, migration `0004_catalog.ts` | DM-019 to DM-022; §4.2 source revision | Source identity and revision kept; upserts create revisions |
| WP-4.6 | Catalog sync job | B | 4.5, 1.7 | `app/src/networks/sync-catalog.ts`, `server/src/worker/sync.ts` | API-073, API-074; CT-015 | Cursor and freshness watermark; malformed payload quarantined, never approved |
| WP-4.7 | Disabled credential and safe failure | B | 4.4, 4.6 | `app/src/networks/sync-catalog.ts` | CT-009 | Sync fails safely; previously approved programs are not newly approved |
| WP-4.8 | Eligibility policy (pure) | C | 4.5, 3.6 | `domain/src/eligibility/policy.ts` | §3 Eligibility; DM-023 to DM-025 | Program × property × geography × channel × consent × contract → allow/deny with reasons; unknown = deny |
| WP-4.9 | Eligibility decision persistence | C | 4.8, 1.6 | `pg/src/eligibility/`, migration `0005_eligibility.ts` | DM-024; §5 Program participation | Decisions versioned with evidence; no silent overwrite |
| WP-4.10 | Program approval request | C | 4.9 | `app/src/eligibility/request-approval.ts` | API-035; §5 | Request state visible; approval only via network-reported state |
| WP-4.11 | Directory and network screens | D | 1.14, 4.9 | `web/src/features/directory/`, `web/src/features/networks/` | UI-026 to UI-030, UI-073, UI-076 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §4 render all states |
| WP-4.12 | Activate network conformance | E | 4.2, 4.6, 4.7, 4.8 | `packages/conformance/src/ct/networks.test.ts` | CT-009, CT-010 (eligibility half), CT-015 | Green against simulator |

---

## 7. Wave 5 — Links, redirect, click trace (milestone M4)

Goal: the first user-visible value. Approved publishers create links, visitors are redirected safely and quickly, and clicks are recorded once.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-5.1 | Link aggregate and destination allow-list | A | 4.9 | `domain/src/links/link.ts`, `domain/src/links/destination.ts` | §5 Link; DM-027, DM-028; §4.4 | States draft → active → paused/revoked; destination scheme and host validated |
| WP-5.2 | Link create, preview, edit, pause, revoke | A | 5.1, 4.9, 2.11 | `app/src/links/` | UC11; API-036 to API-039, API-040 | Every command checks eligibility and property approval; CT-006 link path green |
| WP-5.3 | Bulk CSV jobs | A | 5.2, 1.10 | `app/src/links/bulk.ts`, `pg/src/links/bulk-jobs.ts`, `server/src/http/bulk.ts` | UC12; API-041, API-042; DM-029 | Per-row transaction; per-row result; stable submission ID; partial success allowed |
| WP-5.4 | Route view and Redis cache | B | 5.1, 0.6 | `app/src/routing/route-view.ts`, `redis/src/route-cache.ts` | Blueprint §5.3; ADR-007 | Route view includes destination, decision, state, version |
| WP-5.5 | Version invalidation and revocation | B | 5.4, 1.7 | `app/src/routing/invalidate.ts` | CT-014 | Revocation effective ≤ 5 s; stale allow loses to effective deny |
| WP-5.6 | Redirect handler | B | 5.4, 5.5, 5.8 | `server/src/http/redirect.ts` | UC13; UI-036; API-043 | 302 / 410 / 503 mapped; no wait on storage; fail closed |
| WP-5.7 | Destination re-validation at redirect | B | 5.6 | `domain/src/links/destination.ts` | CT-011 | Unsafe or unapproved host blocked at redirect time, not only at creation |
| WP-5.8 | Click ingestion | C | 1.7 | `app/src/attribution/record-click.ts`, `pg/src/attribution/click-store.ts`, migration `0006_clicks.ts` | API-044; DM-030; CT-013 | At-most-one logical click per dedup key; distinct legitimate clicks kept |
| WP-5.9 | Click analytics queries | C | 5.8 | `app/src/reporting/clicks.ts`, `server/src/http/reports.ts` | API-045; UI-037; §8 data_stale | Cursor pagination; `as_of` and `data_stale` returned |
| WP-5.10 | Baseline risk flags | C | 5.8 | `app/src/risk/flag-clicks.ts`, `pg/src/risk/` | DM-060; R7 | Duplicate and self-click heuristics raise flags; flags do not block clicks yet |
| WP-5.11 | Link and analytics screens | D | 1.14, 5.2, 5.3, 5.9 | `web/src/features/links/`, `web/src/features/analytics/` | UI-031 to UI-035, UI-037 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §5 render all states |
| WP-5.12 | Activate link conformance | E | 5.2 to 5.8 | `packages/conformance/src/ct/links.test.ts` | CT-006, CT-010, CT-011, CT-013, CT-014 | Green in-process and on built binary |

---

## 8. Wave 6 — Conversions and ledger (milestone M5)

Goal: imported network transactions become correct, auditable publisher earnings. The ledger domain is pure and has no dependency on links, so it can start during Wave 4.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-6.1 | Journal, postings, accounts | A | 1.1 | `domain/src/ledger/journal.ts`, `posting.ts`, `account.ts` | §5.1 invariant 1, 2; DM-038 to DM-040 | Journal requires ≥2 postings summing to zero per currency; property test on random sequences |
| WP-6.2 | Share rules and largest-remainder allocation | A | 6.1 | `domain/src/ledger/share-rule.ts`, `allocate.ts` | §5.1 invariant 3; DM-026, DM-037; ADR-005 | `publisher + platform + other = recognized` exactly; rounding version recorded |
| WP-6.3 | Ledger persistence and balance constraint | B | 6.1, 1.6 | `pg/src/ledger/`, migration `0007_ledger.ts` | §5.1; Blueprint §5.1 | Deferred constraint rejects unbalanced commit; property test against Postgres; at most one reversal per `reversal_of`, enforced by a unique constraint |
| WP-6.4 | Reversals and corrections | A | 6.1 | `domain/src/ledger/reversal.ts` | §5.1 invariant 4, 8 | Reversal links to original; original never mutated |
| WP-6.5 | Import batches and revisions | B | 4.1, 1.5 | `app/src/conversions/import-batch.ts`, `pg/src/conversions/batches.ts`, migration `0008_conversions.ts` | DM-031, DM-032; CT-012, CT-018 | Replay of unchanged batch is a no-op; changed row creates revision |
| WP-6.6 | Conversion model and status events | B | 6.5 | `domain/src/conversions/conversion.ts`, `app/src/conversions/status.ts` | DM-033 to DM-035; §5 Conversion source fact | Status transitions recorded as events; adjustments are new rows |
| WP-6.7 | Attribution matching | B | 6.6, 5.8 | `app/src/conversions/match.ts` | DM-036; CT-020 | Matches within window; unmatched goes to exception queue; never auto-assigned |
| WP-6.8 | Pull transactions from connector | B | 4.2, 6.5 | `app/src/conversions/pull.ts` | §6.1 List transactions and adjustments | Cursor-based; uses simulator in CI |
| WP-6.9 | Publisher balance view | C | 6.2, 6.6 | `app/src/finance/balances.ts`, `pg/src/finance/balances.ts` | DM-044; CT-016, CT-017; §5.1 invariant 10 | Estimated, approved, available separated; approved-not-remitted is not available |
| WP-6.10 | Immutable statements | C | 6.9 | `app/src/finance/statements.ts`, migration `0009_statements.ts` | DM-050; API-052, API-053 | Statement content hashed; regenerating does not change a closed period |
| WP-6.11 | Earnings reports | C | 6.9, 5.9 | `app/src/reporting/earnings.ts` | API-046, API-047; UI-042 | Amounts carry currency and `as_of`; stale source shows `data_stale`, never zero |
| WP-6.12 | Finance ops screens | D | 1.14, 6.7, 6.10 | `web/src/features/finance-ops/`, `web/src/features/statements/` | UI-039, UI-040, UI-041, UI-043, UI-046, UI-053 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §6 render all states |
| WP-6.13 | Activate finance conformance (part 1) | E | 6.5 to 6.10 | `packages/conformance/src/ct/finance-1.test.ts` | CT-012, CT-016 to CT-018, CT-020 | Green |

### Wave 6 follow-up packages

The current migration registry includes `0024_better_auth_admin.ts` after `0023_payout_batches`. The OZE-3262 and OZE-3261 follow-ups own distinct migration files registered in serialized order: `0025_attribution_persistence.ts` before `0026_transaction_pull_cursors.ts`. Dependencies below include only the blocked-by relations for these follow-ups; registry sequencing is called out explicitly where it applies. OZE-3265 carries Linear lane label `lane-E`. For OZE-3265, TP-W6-050/051 are end-to-end assertions owned by OZE-3265 and exercise/reuse WP-6.9 balance behavior and WP-6.4 reversal behavior. The Wave 6 test-plan rows TP-W6-044–052 merged to `main` in PR #163. These rows describe planned acceptance criteria and do not assert that implementation has passed.

| Issue / WP | Lane | Depends on | Package / path | Tests | Done when |
|---|---|---|---|---|---|
| OZE-3262 / WP-6.7 follow-up | B | WP-6.7 / OZE-3178 | `packages/adapter-postgres/src/migrations/0025_attribution_persistence.ts` | TP-W6-021–024, TP-W6-044/045, CT-020 | Postgres match/exception persistence; publisher resolved by click→link join; unique exception per conversion; `last_click_in_window` audit; no publisher without qualifying click |
| OZE-3261 / WP-6.8 follow-up | B | WP-6.8 / OZE-3179; OZE-3262 solely for migration-registry sequencing | `packages/adapter-postgres/src/migrations/0026_transaction_pull_cursors.ts` | TP-W6-025/046 | Cursor persistence for transaction pulls. OZE-3262 must merge first because both packages edit `migrations/index.ts`; it owns migration `0025`, followed by this migration `0026`. |
| OZE-3263 / WP-6.9 follow-up | C | WP-6.6 / OZE-3177; WP-6.7 / OZE-3178; OZE-3262 for persisted attribution; finance review required | Postgres publisher balance source | TP-W6-026–029, TP-W6-047, CT-016/017 | Postgres balance source mirrors app behavior for attribution, status, adjustment, and clearance. |
| OZE-3264 / WP-6.10 follow-up | C | WP-6.10 / OZE-3181 | Postgres `StatementStore`; fake/Postgres contract; API-052/053 routes | TP-W6-030/034, TP-W6-048/049 | Statement persistence and routes satisfy the fake/Postgres contract; regenerating a closed period through the real Postgres store leaves stored statement content and hash unchanged. |
| OZE-3265 / WP-6.13 follow-up | E | WP-6.1 / OZE-3172; WP-6.3 / OZE-3174; WP-6.4 / OZE-3175; WP-6.5 / OZE-3176; WP-6.6 / OZE-3177; WP-6.13 / OZE-3184; OZE-3262 must merge first to serialize shared edits to `migrations/index.ts` and `packages/conformance/src/ct/finance-1.test.ts`; OZE-3261 must merge first to serialize its shared `migrations/index.ts` registration | `packages/conformance/src/ct/finance-1.test.ts` and ledger posting integration | TP-W6-017/029/050/051, CT-016 | An approved conversion posts exactly once to the real ledger; its reversal links without mutating original history. |
| OZE-3266 / WP-6.11 follow-up | C | WP-6.11 / OZE-3182; OZE-3263 | Wave 6 Postgres `EarningsSource` only; fake/Postgres parity | TP-W6-031/032/052 | `data_stale` is not zero; currency and `as_of` are preserved. Wave 7 payable/paid and Wave 8 API-047 are outside this row and must be separately tracked under their owning packages. |

---

## 9. Wave 7 — Settlement and payouts (milestone M6)

Goal: money moves safely. Settlement clears only what is matched and eligible. Payouts never pay twice, and an ambiguous outcome is never retried blindly.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-7.1 | Settlement receipts | A | 6.3 | `app/src/settlement/receipts.ts`, `pg/src/settlement/`, migration `0010_settlement.ts` | DM-041; UI-045 | Receipts imported with source identity; manual upload path |
| WP-7.2 | Receipt matcher | A | 7.1, 6.7 | `app/src/settlement/match.ts`, `domain/src/settlement/allocation.ts` | DM-042, DM-043; CT-021 | Partial match clears only matched portion; remainder becomes exception |
| WP-7.3 | Funding state machine | A | 7.2 | `domain/src/settlement/funding.ts` | §5 Funding fact | expected → reported settled → receipt matched → cleared; approved is not cleared |
| WP-7.4 | Payout provider port and simulator | B | 1.12 | `app/src/ports/payout-provider.ts`, `kit/src/payout-sim/` | §6.2 | Simulator produces timeouts, duplicate callbacks, out-of-order status |
| WP-7.5 | Payout methods | B | 7.4, 2.12 | `app/src/payouts/methods.ts`, `pg/src/payouts/methods.ts`, migration `0021_payout_methods.ts` (0011 is taken by program_approvals) | DM-046; UI-047, UI-048 | Provider-hosted enrollment; no raw account data stored |
| WP-7.6 | Holds and minimum payout policy | B | 6.9 | `domain/src/payouts/policy.ts`, `pg/src/payouts/policy.ts` | DM-045; §4.5 | Versioned policy; historical payouts unaffected by a new version |
| WP-7.7 | Batch preparation and reservation | C | 7.3, 7.5, 7.6, 6.9 | `app/src/payouts/batch.ts`, `domain/src/payouts/reservation.ts`, `pg/src/payouts/reserve.ts`, migration `0023_payout_batches.ts` | DM-047, DM-048; CT-022 | `FOR UPDATE` on balance row; reservation key unique; concurrent requests cannot over-reserve |
| WP-7.8 | Maker-checker approval | C | 7.7, 2.9 | `app/src/payouts/approve.ts`, `domain/src/payouts/approval.ts` | UI-050, UI-051; §4.1 | Approver ≠ preparer; both recorded in audit |
| WP-7.9 | Dispatch, unknown outcome, reconciliation | C | 7.4, 7.8 | `app/src/payouts/dispatch.ts`, `app/src/payouts/reconcile.ts`, `server/src/worker/payouts.ts` | §5 Payout; §6.2; DM-049; CT-019 | Timeout → `unknown`; query before retry; `unknown` never auto-paid; reversal after payment creates deficit |
| WP-7.10 | Publisher payout history | D | 7.9, 6.10 | `web/src/features/payouts/` | UI-052, UI-053 | Shows paid, failed, unknown with explanation |
| WP-7.11 | Finance maker-checker and batch screens | D | 7.8, 1.14 | `web/src/features/payout-ops/` | UI-049 to UI-051 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §7 render all states |
| WP-7.12 | Payout runbook | C | 7.9 | `docs/runbooks/payout-unknown.md` | Plan M6 gate | Operator can resolve an `unknown` payout from the document alone |
| WP-7.13 | Activate finance conformance (part 2) | E | 7.1 to 7.9 | `packages/conformance/src/ct/finance-2.test.ts` | CT-019, CT-021, CT-022 | Green, including chaos scenarios |

---

## 10. Wave 8 — Developer platform (milestone M7)

Goal: publishers and partners integrate through scoped keys, signed webhooks, paginated reports, and exports, with the same authorization rules as the UI.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-8.1 | Scoped API keys | A | 2.2, 1.10 | Better Auth API key plugin; `server/src/http/key-auth.ts` maps keys to `Principal`; `app/src/actions/developer/` for key metadata only | DM-052; API-059 to API-062; UI-054 to UI-056 | Key shown once; stored hashed by plugin; rotate with grace period; revoke immediate; tests cover our scope mapping, not hashing |
| WP-8.2 | API key principal and guard scopes | A | 8.1, 2.11, 2.14 | `server/src/http/key-auth.ts` (resolves key to `Principal`), `server/src/http/guards/` (key scopes), `redis/src/rate-limit.ts` | §4.1; §4.5 | Key principal goes through the same guard table as sessions; scope enforced on every route; rate limit headers; policy-driven limits |
| WP-8.3 | Webhook endpoints and signing | B | 1.7, 8.1 | `app/src/developer/webhooks.ts`, `pg/src/developer/webhooks.ts` | DM-054; API-063 to API-065, API-068; UI-057, UI-058 | Signed payloads; secret rotation; SSRF-safe endpoint validation |
| WP-8.4 | Delivery worker, retries, log | B | 8.3 | `app/src/developer/deliver.ts`, `server/src/worker/webhooks.ts`, `pg/src/developer/deliveries.ts` | DM-055; API-066, API-067; UI-059 | Bounded retries; dead-letter; test delivery; log shows attempts |
| WP-8.5 | Cursor pagination standard | C | 1.9 | `contracts/src/pagination.ts`, `app/src/shared/cursor.ts` | §7 list rules | Stable ordering; opaque cursor; bounded page size; applied to every list endpoint |
| WP-8.6 | Reports API | C | 5.9, 6.11, 8.5 | `server/src/http/reports.ts` | UC23; API-045 to API-047, API-049 | Filters and pagination; `as_of` on every total |
| WP-8.7 | Async exports | C | 8.5, 1.7 | `app/src/reporting/exports.ts`, `server/src/worker/exports.ts`, migration `0013_exports.ts` | DM-071; API-048; UI-060 | Export lifecycle accepted → processing → completed/failed; signed short-lived download |
| WP-8.8 | OpenAPI publication and contract tests | C | 1.9, 8.5 | `contracts/openapi.json`, `conf/src/api/` | §7; Blueprint §6.2 | Published spec matches server; breaking change fails CI |
| WP-8.9 | Reference consumer | D | 8.1, 8.3, 8.6 | `ops/reference-consumer/` | Plan M7 gate | Built only from public docs; completes report, webhook, and rotation flows |
| WP-8.10 | Developer screens | D | 1.14, 8.1, 8.3, 8.4 | `web/src/features/developer/` | UI-054 to UI-060 | Screens in [ui/SKELETONS.md](../ui/SKELETONS.md) §8 render all states |

---

## 11. Wave 9 — Optimize beta (milestone M8, legal-gated)

Goal: opted-in publishers get consent-aware, policy-controlled link rewriting with zero unwanted rewrites.

**Entry gate:** legal review of consent handling per target market is complete and recorded as an ADR. No WP in this wave starts before the gate. WP-9.0 is that gate.

| WP | Title | Lane | Depends on | Package / path | Spec refs | Done when |
|---|---|---|---|---|---|---|
| WP-9.0 | Legal and consent gate | — | — | `docs/adr/` file for Optimize consent, under the next free number (ADR-013 is taken by Rakuten) | Plan M8; R6 | Signed decision with target markets and CMP plan |
| WP-9.1 | Consent configuration and CMP adapter | A | 9.0 | `domain/src/optimize/consent.ts`, `server/src/adapters/cmp/` | DM-062; UC27; UI-071 | Denied or unknown consent blocks any rewrite |
| WP-9.2 | Rewrite enforcement | A | 9.1, 5.4 | `domain/src/optimize/rewrite-gate.ts` | UC27; CT (Optimize) | All gates pass before rewrite; default-off |
| WP-9.3 | Installation: SDK, wizard, health | B | 9.0, 1.14 | `packages/sdk-web/`, `web/src/features/optimize-install/` | DM-064; UC26; UI-068, UI-070 | Installation state machine disabled → configured → eligible → enabled → suspended/disabled |
| WP-9.4 | Monetization rules | C | 9.2 | `domain/src/optimize/rules.ts`, `web/src/features/optimize-rules/` | DM-063; UI-069 | Rules versioned; editor shows effect preview |
| WP-9.5 | Route decisions with explanation | C | 9.4, 4.8 | `app/src/optimize/decide.ts`, migration `0014_optimize.ts` | DM-065; UI-074 | Each decision stores reasons; explanation rendered |
| WP-9.6 | Holdout experiments | C | 9.5 | `app/src/optimize/experiments.ts` | DM-066; UI-072, UI-073 | Holdout assignment stable; experiment health visible |
| WP-9.7 | Opt-out and exclusions | A | 9.2 | `app/src/optimize/exclusions.ts` | UC27; plan M8 gate | Opt-out honored within documented latency; exclusions applied before rewrite |

---

## 12. Cross-cutting work (runs alongside any wave)

| WP | Title | When | Done when |
|---|---|---|---|
| WP-X.1 | Security review of identity and payouts | End of W2, end of W7 | Findings closed or accepted in ADR |
| WP-X.2 | Load test on built binary | End of W5, end of W8 | Targets in WP-0.10 met; results stored in `ops/load/results/` |
| WP-X.3 | Ledger reconciliation job | From W6 | Nightly job report shows zero unexplained variance on sandbox data |
| WP-X.4 | Spec drift check | Every wave | Conformance cases touched by the wave are green; no spec change without a version bump |
| WP-X.5 | Accessibility audit | End of each wave with UI | Keyboard path and screen reader announcements checked for the wave's screens |

---

## 13. Traceability summary

| Milestone | Waves | Conformance cases closed |
|---|---|---|
| M0 | 0 | — (stubs created) |
| M1 | 1, 2 | CT-001 to CT-005, CT-008 |
| M2 | 3 | CT-006, CT-007 |
| M3 | 4 | CT-009, CT-010 (eligibility), CT-015 |
| M4 | 5 | CT-006 (link path), CT-010, CT-011, CT-013, CT-014 |
| M5 | 6 | CT-012, CT-016, CT-017, CT-018, CT-020 |
| M6 | 7 | CT-019, CT-021, CT-022 |
| M7 | 8 | Developer conformance suite (contract, rate-limit, signature, pagination, idempotency) |
| M8 | 9 | Optimize zero-rewrite and opt-out suite |

**Decisions this plan adds:** ADR-012 (network adapter deferral, superseded by ADR-013) and ADR-013 (Rakuten Advertising selected as first network; Plan Q1 decided). The plan originally reserved ADR-013 for Optimize consent (depends on WP-9.0); that work package needs a new number.
