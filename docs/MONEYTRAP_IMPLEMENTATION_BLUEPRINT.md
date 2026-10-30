# Moneytrap — Implementation Blueprint

**Status:** Draft for review. Documents only; no code yet.
**Governs:** how we build what [MONEYTRAP_PROJECT_PLAN.md](MONEYTRAP_PROJECT_PLAN.md) describes. Behavior is still defined by the [technical specification](legacy/MONEYTRAP_TECHNICAL_SPECIFICATION_COMPLETE.md); this file only chooses means.

---

## 1. Stack decisions

| Concern | Choice | Why | Fallback / watch-out |
|---|---|---|---|
| Runtime, package manager, test runner, bundler | **Bun** | One toolchain; `bun test`; `bun build --compile` for the single binary | Verify every native dependency in spike C |
| HTTP API | **Elysia 2** | Type-safe routes, TypeBox schemas, built-in OpenAPI generation | Confirm the v2 API surface in spike C before M1; keep HTTP adapters thin so a framework swap touches only `apps/api` |
| Database | **PostgreSQL** | Transactions, constraints, `numeric`/`bigint`, row locks for reservations | — |
| Query layer | **Kysely** | Typed SQL, explicit transactions, no ORM magic on money paths | Use Kysely's `Migrator` with statically imported migrations (required for the binary) |
| Postgres driver | `pg` via Kysely `PostgresDialect` | Mature; Bun-compatible in our tests | Bun's native SQL client is a later option, not a M0 bet |
| Cache | **Redis** | Route views, rate limits, short-lived tokens | Cache is never the source of truth |
| Queue | **Redis-backed job queue** fed from a **Postgres outbox** | Transactional enqueue: a domain change and its job commit together | Library choice (BullMQ / custom) decided in spike B |
| UI components & styling | **shadcn/ui** (Tailwind CSS, Radix primitives) | We own the component source; accessible primitives out of the box; matches the a11y requirements in spec §8 | Components are copied into `packages/ui`, not installed as a black box |
| Client data fetching & cache | **TanStack Query** | Server state, cache invalidation after actions, pagination, `data_stale` display | — |
| Client routing | **TanStack Router** (file-based, type-safe search params) | Typed routes and search params for filters and pagination; route guards read the session before render | Server authorization still applies; client guards are UX only (spec §8) |
| Tables | **TanStack Table** with shadcn Data Table | Sorting, filtering, and cursor pagination for ledger, link, and queue lists | — |
| Forms | **TanStack Form** with TypeBox validation from `packages/contracts` | One validation schema for client and server | — |
| Frontend build | React + TypeScript, built with Vite; assets embedded in the binary | Mature dev server and HMR; output is static files the binary serves | ADR-008 confirms Vite over Bun's HTML bundler |
| Authentication | **Better Auth** (email/password, sessions, email verification, password reset, two-factor TOTP and backup codes, organization plugin for invitations and memberships, API key plugin) | Removes hand-rolled credential, session, recovery, MFA, and invitation code, which are the riskiest parts to build ourselves | Verify the Kysely adapter, plugin interactions, and binary behavior in spike C; if it fails, fall back to a documented alternative ADR |
| Authorization | **Better Auth organization access control** for role-to-permission mapping; the pure `can()` wrapper in `domain` calls it | One source for roles; no custom permission table to maintain | Add **CASL** only if we need attribute-based rules (for example, "own property in an approved state") that role mapping cannot express |
| Rate limiting | Better Auth rate limiting with Redis storage, plus our Redis token bucket for redirect and API routes | Auth endpoints get safe defaults without custom code | Limits are policy values (spec §4.5) |
| Validation & API types | TypeBox (via Elysia) shared through `packages/contracts` | One schema source for server validation, OpenAPI, and client types | — |
| Lint / boundaries | Biome (format + lint) and `dependency-cruiser` rules | Enforces hexagonal dependency direction in CI | — |
| Integration tests | Real Postgres and Redis via Docker Compose; Testcontainers if it runs under Bun | Tests the SQL and locks we actually ship | — |
| E2E tests | Playwright against the built binary | Tests the artifact we ship, not dev mode | Starts at M4 |
| Observability | OpenTelemetry traces and metrics; structured logs with redaction | Required by spec §10 | Exporter chosen at M0 |

**Single binary.** `bun build --compile` produces one executable containing: the Elysia server, the built React assets (imported with `with { type: "file" }`), and the migration set. The binary runs migrations on boot behind a flag (`--migrate`) rather than implicitly, so operators control schema changes. Configuration comes from environment variables only; no config files are read from disk at runtime.

---

## 2. Monorepo layout

```
moneytrap/
├── apps/
│   ├── server/            # Composition root: bootstrap, HTTP route plugins, process entry point
│   │   ├── src/http/      # Elysia plugins per bounded area (identity, orgs, links, redirect, …)
│   │   ├── src/worker/    # Queue consumers and outbox relay entry point
│   │   └── src/main.ts    # Parses config, wires adapters, starts server/worker by flag
│   └── web/               # React app (publisher workspace, ops console)
├── packages/
│   ├── domain/            # Pure TypeScript. Entities, value objects, state machines, policies. No I/O, no framework imports.
│   ├── app/               # Actions (writes) and queries (reads), one file each. External ports (clock, notifier, connectors, providers) live here.
│   ├── schema/            # Kysely `DB` types only (generated from migrations). No runtime code.
│   ├── contracts/         # TypeBox schemas for API requests/responses/errors; generated OpenAPI; client types for web.
│   ├── adapter-postgres/  # Kysely connection factory, migrations, outbox relay, transaction helper (no repositories)
│   ├── adapter-redis/     # Route-view cache, rate limiter, queue transport
│   ├── adapter-network-<name>/  # One package per affiliate network connector (capability profile + mapping)
│   ├── adapter-payout-<provider>/ # Payout/verification provider (M6)
│   ├── adapter-notify/    # Email/notification provider
│   ├── test-kit/          # In-memory fakes for every port, fixture builders, deterministic clock, network/payout simulators
│   └── conformance/       # Executable CT-### cases, runnable against the public HTTP API and the in-process app
├── ops/
│   ├── docker-compose.yml # Postgres + Redis for local dev and integration tests
│   └── load/              # Load scripts for redirect and reporting SLOs
├── docs/adr/              # Architecture decision records (ADR-001 …)
└── MONEYTRAP_*.md           # Specification and plan documents (existing)
```

Rules:

- `domain` imports nothing from the workspace.
- `app` imports `domain` and `schema` (types only). It never imports an adapter, Elysia, or Redis. Database access happens through Kysely in actions and queries; there is no repository layer.
- Adapters implement `app` ports and never import each other.
- `apps/server` is the only place that knows about every adapter. It is the composition root and nothing else wires dependencies.
- `apps/web` imports `contracts` only. It never imports server code.

Enforce these with `dependency-cruiser` rules in CI. A violation fails the build.

---

## 3. Hexagonal style, simplified

We use two kinds of application code, Laravel-style, and keep ports only where a technology can really be swapped.

### 3.0 Actions and queries

- **Action** = one write use case. One file, one exported function: `export async function registerUser(input: RegisterUserInput, ctx: Ctx): Promise<Result<RegisterUserOutput, DomainError>>`. Example path: `app/src/actions/identity/register-user.ts`.
- **Query** = one read use case. One file, returns a DTO, never mutates. Example path: `app/src/queries/links/list-links.ts`.
- **Actions only mutate.** An action changes state and records the change (state, outbox row, audit row) in one transaction. It returns the new state; it does not read for presentation and does not check who is calling.
- **Queries only read.** A query returns a DTO and never writes. No side effects, no audit writes.
- **`Ctx`** is the only dependency bag an action or query receives: `{ db, clock, ids, notifier, actor, … }`. `actor` is an identifier recorded in audit rows, not a permission. `db` is a Kysely instance or a transaction; the action decides when to open one.
- **Authorization is not in actions or queries.** It happens before they run (§3.1). Actions trust that their caller has been authorized, and they enforce only business invariants (state transitions, uniqueness, eligibility rules such as "property must be approved before a link").
- **Actions own their SQL.** Kysely queries are written inline in the action or query file. When two files need the same query, extract a function next to them in the same area folder (`app/src/actions/links/_queries.ts`). No shared "repository" objects.
- **Composition:** an action may call another action when it needs that behavior inside the same transaction, passing the same `ctx`. Keep this shallow (one level in practice).
- **HTTP is a thin adapter.** A route authenticates, validates with TypeBox, calls one action or query, and maps the result. No business logic in routes.

Why this shape: it matches how the team already thinks about a request, puts one feature in one file group, and removes the interface-per-table layer that otherwise doubles every change.

### 3.1 What we keep from hexagonal

1. **Domain is pure.** State machines, money, eligibility, allocation, and policy are functions over values. No `db`, no clock, no I/O. This is the part of the architecture that protects money and access rules, and it is where most unit tests live.
2. **Ports only at real seams.** A port exists only where the implementation is external or swappable: `Clock`, `IdGenerator`, `Notifier`, `NetworkConnector`, `PayoutProvider`, `SecretBox`, `RouteCache`, `DnsResolver`. Each has one fake in `test-kit`. Password hashing is not a port; Better Auth owns it.
3. **Authorization is a boundary concern, outside actions and queries.** Three layers, all in `apps/server`:
   - **Authenticate** (`http/auth.ts`): Better Auth's session or API key handler resolves the caller into a `Principal`. Fails with `UNAUTHENTICATED`. We do not write session or token code.
   - **Authorize** (`http/guards/`): each route declares a permission (e.g. `links.create`) and a scope resolver. The resolver loads the target resource's scope through a query, then calls the pure `can(principal, permission, scope)` from `domain`. Denied → `FORBIDDEN`; resource not visible to this principal → `RESOURCE_NOT_FOUND`, the same as a missing resource (spec §4.1).
   - **Execute**: the route calls one action or query with already-authorized input.
   - Workers and schedulers never call actions with a user principal. They use a named system principal, declared in the job definition, and the same guard table covers them.
   - Business preconditions such as "property must be approved" stay in the action. They are not permission checks.
4. **Domain errors are values.** Actions return `Result` with stable codes from spec §7.1. HTTP maps codes to statuses in one table.
5. **Transactions are explicit.** Money and access changes run in one `db.transaction()` with the outbox row written inside it. Cross-transaction work goes through the outbox only.

### 3.2 What we drop

- Repository interfaces and per-table repository classes. Kysely is the query layer; a repository would only re-wrap it.
- Generic base classes, a "domain event bus", and a DI container. `apps/server/src/main.ts` builds `ctx` explicitly.
- Fake repositories in tests. Action tests use a real Postgres (see §6.2) and fake only the external ports.

### 3.3 Ports for the wedge (M0–M4)

| Port | Implemented by | Notes |
|---|---|---|
| `Clock` | system / fake | No `Date.now()` in `domain` or `app`. |
| `IdGenerator` | random opaque IDs | Prefixed by type (`lnk_`, `pub_`); spec §4.2. |
| `Notifier` | email adapter / dev sink | Dedup identity required (spec §6.3). |
| `SecretBox` | key-ID encryption | Network credentials; never returned by an API. |
| `NetworkConnector` | network adapter / simulator | Capability profile and §6.1 operations. |
| `RouteCache` | Redis | Keyed by link ID and version; see §5.3. Redis is never the source of truth. |
| `DnsResolver` | DNS adapter / fake | Property verification challenges. |
| `PayoutProvider` | provider adapter / simulator | M6; stable request identity; spec §6.2. |

Eligibility, allocation, and ledger balancing are domain functions, not ports. Persistence is not a port.

---

## 4. Module map (bounded areas → code)

| Spec capability | `app` actions/queries folder | Milestone |
|---|---|---|
| Identity | `identity/` | M1 |
| Organization & Access | `access/` | M1 |
| Publisher Lifecycle & Properties | `publisher/`, `properties/` | M2 |
| Partnerships & Networks, Catalog, Eligibility | `networks/`, `catalog/`, `eligibility/` | M3 |
| Links & Routing, Attribution & Analytics | `links/`, `routing/`, `attribution/` | M4 |
| Conversions, Finance | `conversions/`, `finance/` | M5, M6 |
| Developer Platform | `developer/` | M7 |
| Risk & Privacy, Optimize | `risk/`, `privacy/`, `optimize/` | M4 (risk flags), M8 (rest) |
| Operations | `operations/` | Starts M0 (health, audit) |

Each folder is a unit of ownership. A change to `finance/` needs a finance reviewer.

---

## 5. Data and concurrency design

### 5.1 Money

- Amounts are **`bigint` minor units** in the domain (`Money = { minor: bigint; currency: CurrencyCode }`). Currency exponent comes from a static ISO 4217 table in `domain`.
- Postgres stores minor units in `bigint` columns, with a `currency` column and a check constraint that every posting's currency matches its account's currency.
- JSON encodes amounts as the decimal string required by spec §7.2, produced by a single formatter. Parsing is strict; no `parseFloat` anywhere.
- Share splits use **largest-remainder** allocation under a versioned rounding rule, so `publisher + platform + other = recognized` holds exactly (spec §5.1 invariant 3).
- Double-entry: every journal has ≥2 postings that sum to zero per currency. Enforced by a deferred constraint trigger and by a domain check before insert.

### 5.2 Idempotency

- Every mutating endpoint accepts an `Idempotency-Key` header (required for money and key-issuance commands).
- The key, a hash of the normalized request, and the stored response live in `idempotency_requests` (DM-053).
- Same key + same hash → return the stored response. Same key + different hash → `STATE_CONFLICT`.
- The idempotency row is written in the same transaction as the effect.

### 5.3 Redirect path: cache, revocation, fail-closed

1. `GET /r/{token}` resolves token → link ID through a Redis key, falling back to Postgres on miss.
2. A **route view** (destination, eligibility decision, link state, `version`) is cached with a short TTL (policy value, initially 60 s).
3. Every state change that affects routing bumps the link's `version` and publishes an invalidation through the outbox. The redirect checks the cached `version` against a version key in Redis; a mismatch forces a DB read.
4. **Revocation guarantee:** a revoked or suspended link is denied within the documented window (initially ≤ 5 s, enforced by the version check, not by TTL alone). This satisfies CT-014.
5. **Fail closed:** if Redis and Postgres are both unreachable, return `503` with a neutral page. Never redirect on a guess.
6. The click event is written to the queue, not inline. The 302 does not wait on storage.

### 5.4 Outbox and queue

- Domain changes write rows to `outbox_events` in the same transaction.
- A relay process reads unpublished rows in order (`FOR UPDATE SKIP LOCKED`), pushes them to the Redis queue, and marks them published. The relay is at-least-once.
- Consumers dedupe on `event_id` (`inbox_processed_events`, DM-057). Effects are idempotent by construction.
- Failures go to bounded retries with backoff, then to `job_failures` (DM-058) for inspection and replay by an operator with permission.

### 5.5 Import replay

Network imports are stored as batches with the source's own transaction IDs and revision numbers. Re-running a batch is a no-op for unchanged rows and creates a new revision (not an overwrite) for changed rows. This is the mechanism behind CT-012 and CT-018.

### 5.6 Locking and reservations

- Payout reservations use `SELECT … FOR UPDATE` on the publisher balance row, plus a unique constraint on `(publisher_id, reservation_key)`. This is the mechanism behind CT-022.
- Link creation and bulk jobs use per-item transactions so one bad row does not roll back the batch (spec §7, bulk rule).

---

## 6. Test strategy (TDD)

### 6.1 The loop

For every behavior: **write the failing test first** at the lowest layer that can express it, make it pass, then refactor. Conformance cases are the outer loop: a CT-case is red until its feature exists and green only when its public-API test passes.

### 6.2 Layers

| Layer | Target | Tools | Speed budget | Examples |
|---|---|---|---|---|
| Domain unit | `domain` | `bun test` | < 1 s total per package | Money arithmetic, state machines, eligibility policy |
| Property | `domain`, `finance` | `fast-check` | < 30 s in CI | Ledger balances for any sequence of postings; allocation conserves total; replay is idempotent |
| Action / query | `app` | `bun test` against a real Postgres schema (transaction rolled back per test), external ports faked, fake clock | < 30 s per package | "Revoked link denies even when cache says allow"; unique-constraint and row-lock behavior |
| Adapter contract | each external adapter | same contract suite run against the fake **and** the real adapter | — | `NetworkConnector` and `PayoutProvider` behave identically under the simulator and the real adapter |
| Integration | `adapter-postgres`, `adapter-redis`, outbox relay | `bun test` + Docker Compose | minutes | Concurrency: two parallel redemptions produce exactly one success (CT-002) |
| HTTP | `apps/server` | Elysia `app.handle(new Request(…))`, no network port | seconds | Status and error code mapping; auth headers; pagination |
| Conformance | `packages/conformance` | runs against in-process app, then against the built binary in CI | minutes | CT-001 … CT-022 |
| E2E | `apps/web` + binary | Playwright | minutes; nightly for the full set | Pilot flow: sign up → verify → property → approve → link → redirect |
| Load | `ops/load` | k6 or equivalent | nightly and pre-release | Redirect p95/p99 against the SLO from §8 |

Every layer is required for a capability to be done (spec §13). A green unit suite does not satisfy a concurrency or outage requirement.

### 6.3 Test rules

- Tests use the fake clock. A test that sleeps is a bug.
- No test shares mutable state with another test. Integration tests truncate or use a schema per worker.
- Each bug fix starts with a failing regression test named after the CT-case or spec section it protects.
- Money assertions compare minor units, never floats or formatted strings alone.
- Secrets and tokens never appear in test snapshots; the redaction rules are tested too (spec §4.4).

### 6.4 Test-first backlog from the conformance cases

Import CT-001 … CT-022 as `test.todo` stubs now, tagged by milestone. Each milestone's gate requires its CT-cases to flip from `todo` to passing. The stubs live in `packages/conformance` and are reviewed alongside the spec, so spec changes show up as test diffs.

---

## 7. Security baseline (applies from M1)

- Credentials, sessions, recovery links, email verification, two-factor secrets, and invitations are handled by Better Auth with its defaults. Our config must not weaken them (no custom hashing, no token logging).
- Privileged actions require a recent second factor. We enforce this in the guard layer by checking the session's assurance time.
- Our tests verify configuration, not cryptography: session revocation on password change, recovery link single use, invitation single use, and that no token appears in logs.
- Authorization runs on every route through the guard table (§3.1), before any action or query. A route missing a guard declaration fails the build (a test enumerates all routes). Unknown and foreign resources both return `NOT_FOUND`.
- Redirect destinations pass an allow-list check and scheme validation at link creation **and** at redirect time.
- Rate limits on auth, recovery, and redirect endpoints via Redis token buckets; limits are policy values.
- Secrets (network credentials, payout provider keys) come from environment or a secret store, are encrypted at rest with a key ID for rotation, and are never returned by any API.
- Audit events for every admin, money, access, and risk change (spec §4.4). Audit is append-only at the table level (revoke update/delete from the app role).
- Dependency and secret scanning in CI; SBOM generated for the binary.

---

## 8. Non-functional targets (initial, to be confirmed in M0)

| Dimension | Initial target | Measured by |
|---|---|---|
| Redirect latency | p95 ≤ 50 ms server-side on cache hit; p99 ≤ 150 ms | Load test on the built binary (spike B) |
| Redirect availability | 99.9% monthly, excluding planned maintenance | Synthetic probe + error budget |
| Route revocation | Effective ≤ 5 s | Test with the version check |
| Ledger invariants | 0 violations | Property tests + nightly reconciliation job |
| Import freshness | Source data ≤ 24 h old on the dashboard, else `data_stale` | Watermark check |

These are starting points. Each is recorded as configurable policy with a version (spec §4.5) once confirmed.

---

## 9. Observability and operations

- Every request gets a correlation ID; it is propagated into the outbox, the queue, and the logs.
- Metrics that match spec §10: conversion ingestion lag, route-resolution latency, redirect errors, denied/unknown eligibility, sync drift, ledger check results, settlement mismatches, payout `unknown` count, consent denials, notification failures.
- Dashboards and alerts are code in `ops/`.
- Runbooks exist for: disable a network/program/link quickly, replay an import batch, resolve a payout `unknown`, rotate a credential.
- The ops console is the only UI that can run replays; each replay writes an audit event.

---

## 10. CI/CD and release

- **CI on every push:** format and lint, `dependency-cruiser` boundary check, typecheck, unit and property tests, integration tests (Docker Compose), conformance suite, build the binary for macOS and Linux.
- **Nightly:** full E2E, load test, ledger reconciliation against sandbox fixtures.
- **Release:** the binary is the artifact. Migrations run as a separate, explicit step before the new binary serves traffic. Rollback is "previous binary + backward-compatible schema" (expand/contract migrations only).
- **Schema changes:** expand → migrate data → contract, each in its own release.

---

## 11. Decisions to record as ADRs (M0)

| ADR | Decision | Status |
|---|---|---|
| ADR-001 | Bun as runtime, package manager, test runner, and binary builder | Accepted, 2026-10-31 (gate: Linux run, TP-W0-019) |
| ADR-002 | Elysia 2 as HTTP layer; adapter boundary keeps it replaceable | Accepted, 2026-10-31 (pre-release pins) |
| ADR-009 | Better Auth for authentication, organizations, two-factor, API keys; org access control for roles | Accepted, 2026-10-31 (feature gates in WP-2.2) |
| ADR-010 | shadcn/ui, TanStack Query/Router/Table/Form, Vite for the frontend | Accepted, 2026-10-31 (gate: WP-1.14 web shell verification) |
| ADR-011 | Deferred: OAuth 2.0 for user-delegated client access. M7 ships org-scoped API keys only | Accepted, 2026-10-31 (deferred) |
| ADR-003 | Postgres + Kysely; migrations statically bundled | Accepted, 2026-10-31 |
| ADR-004 | Postgres outbox → Redis queue; at-least-once with consumer dedupe | Accepted, 2026-10-31 (relay gated to WP-1.7) |
| ADR-005 | Money as `bigint` minor units with largest-remainder allocation | Accepted, 2026-10-31 (gate: WP-1.1 domain tests green) |
| ADR-006 | Actions and queries (Laravel-style) over Kysely; pure domain; ports only at external seams; no repositories; no DI container | Accepted, 2026-10-31 |
| ADR-007 | Redirect path: Redis route view with version check; fail closed | Accepted, 2026-10-31 (revised; gated to WP-5.4) |
| ADR-008 | Frontend bundler (Bun HTML bundler vs Vite) | Accepted, 2026-10-31 (Vite; gated to WP-1.14) |

---

## 12. Spikes (M0), with pass criteria

**Spike A — Binary shape.** Build a server that serves an Elysia route, an embedded React page, and runs a Kysely migration against Postgres on `--migrate`. Pass: one executable runs on a clean macOS and a clean Linux machine with no Bun installed at runtime.

**Spike B — Redirect path.** Implement `GET /r/{token}` with Redis route-view cache, version check, and an outbox click event. Pass: meets the §8 latency targets at the agreed load profile; revocation takes effect within 5 s in a test; with both stores down it returns 503 and never redirects.

**Spike C — Library compatibility.** Verify under Bun and the compiled binary: Elysia 2 features we need (schema validation, error mapping, plugin scoping, OpenAPI output) and Elysia mounting Better Auth's handler; Better Auth with the Kysely adapter (Postgres), plus its organization, two-factor, and API key plugins; schema generation from the Better Auth CLI into our migrations; `pg` with Kysely; the Redis client and queue library; OpenTelemetry exporter. Pass: each works in both `bun test` and the compiled binary, or the ADR records a fallback. Community guides were the only sources found for Better Auth + Kysely, so read the official docs first.

Time-box each spike. If a spike fails, record the failure as an ADR with the fallback and continue. Do not extend a spike to rescue a preferred library.

---

## 13. First two weeks, concretely

**Day 1–2**
1. Create the monorepo skeleton from §2 with empty packages and a `bun` workspace.
2. Add Biome, `dependency-cruiser` rules (§2 rules), and a CI workflow that runs them.
3. Add `ops/docker-compose.yml` with Postgres and Redis.

**Day 3–5**
4. Spike A and Spike C in parallel (separate branches).
5. Import CT-001 … CT-022 into `packages/conformance` as `todo` tests, each with its milestone tag.
6. Write ADR-001 … ADR-011 from §11.

**Day 6–10**
7. Spike B on a branch. Write the load profile with the product owner (§8).
8. First red test: `Money` rejects a non-integer minor amount and a currency mismatch (domain unit test, written before the type).
9. First red test: `POST /v1/identity/register` returns the same response for a known and unknown email (CT-001), written as an HTTP-layer test against the Postgres test schema with a fake notifier.
10. Choose ADR-008 (frontend bundler) using the spike A result.

**Exit of week two:** spikes A–C have recorded outcomes, ADR-001 through ADR-011 are accepted or have a dated decision, the conformance backlog exists and is tagged, and the first two domain tests are green.

---

## 14. Known gaps in this blueprint

- Load profile and latency SLO are placeholders until the product owner confirms them (plan open question 5).
- Network connector library choice depends on the partner chosen (plan open question 1); the port and capability profile are stable regardless.
- Payout provider is not selected; M5 only defines the port (plan open question 4).
- Optimize (M8) has no code-level design yet. It is gated on legal review and should not be designed in detail before that review.
