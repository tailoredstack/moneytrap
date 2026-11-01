# Moneytrap — Project Plan (v3 draft)

**Status:** Draft for review. Documents only; no code yet.
**Companions:** [Technical specification](legacy/MONEYTRAP_TECHNICAL_SPECIFICATION_COMPLETE.md) (behavior contract, governs on conflict), [Conformance cases](legacy/MONEYTRAP_CONFORMANCE_CASES.md), [Use cases](legacy/MONEYTRAP_USE_CASES.md), [Implementation blueprint](MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md) (stack, layout, test strategy).

---

## 1. What changed from the spec-first plan

The spec set is thorough about *what must be true*. It is weak on *what we build first, what we prove first, and what we deliberately leave out*. This plan fixes that:

| Gap in the current plan | Change in v3 |
|---|---|
| Eleven-plus capabilities, all described at once | Ruthless wedge: one network, one channel, one country, manual approval. Everything else is a later gate. |
| Finance treated as a phase after "core" | Ledger correctness is a **day-one invariant**, built test-first with property tests, even though payouts ship late. Money bugs are the expensive kind. |
| Optimize (consent-aware auto-rewrite) sits next to Connect | Optimize is a separate bet with its own legal review gate. It does not start until Connect publishers are routing real traffic through safe links. |
| No definition of "learned something" | Each milestone has a hypothesis and a kill/continue metric, not only an exit checklist. |
| Conformance cases are a QA appendix | Conformance cases (CT-001 … CT-022) become the **first backlog**: each is a failing test before feature code exists. |
| Stack is "implementation-neutral" | Stack is chosen (see blueprint) with a time-boxed spike to de-risk the two unknowns: single-binary build and Elysia 2 + Bun in production shape. |

---

## 2. Product thesis and wedge

**Thesis:** Small and mid-size publishers (blogs, comparison sites, creators) lose hours and money juggling several affiliate networks, each with its own link format, reporting lag, and payout threshold. Moneytrap gives them one place to find permitted programs, make safe trackable links, see attributed earnings, and get paid.

**Wedge (first 90 days of product, not of engineering):**

- Channel: websites and editorial blogs only. Social, mobile, and API channels are deferred.
- Source: **one** affiliate network with a documented API and a sandbox. Recommend picking by (a) API coverage of transactions and adjustments, (b) program breadth for our target publishers' niches, (c) how well its link and reporting model fits our redirect. **Decided: Rakuten Advertising (ADR-013).**
- Geography: one country and one currency (USD or the currency the first partner settles in).
- Publisher side: manual KYB and property review by our own ops team. We do not automate review in the wedge.
- Money: we record commissions and statements in the wedge; we move real money only in the Finance milestone.

**Why this wedge:** it tests the one assumption that kills the product if wrong: *will publishers trust a redirect layer and a dashboard enough to route real traffic through it?* Everything else is downstream of that.

---

## 3. Users and jobs

| User | Job to be done | Success looks like |
|---|---|---|
| Publisher owner | "Get paid for the traffic I already send to merchants, with no compliance headaches." | First approved link live within one session of onboarding. |
| Publisher editor | "Create and copy links fast, without breaking them." | Bulk link creation with clear per-row errors. |
| Finance operator (ours) | "Know exactly what we owe, what we are owed, and why." | Every number traces back to an upstream transaction. |
| Compliance / review operator (ours) | "Approve or reject publishers and properties with evidence." | Decision in under a set SLA with a recorded reason. |
| Integration partner (later) | "Pull reports and receive webhooks reliably." | Scoped keys and documented webhooks; no manual CSV. |

---

## 4. Milestones

Each milestone ends with a **gate**: a demo, a test suite, and a decision. Sizing is in relative units until the team and capacity are confirmed (see open questions).

### M0 — Foundations and de-risking (spike milestone)
**Hypothesis:** The chosen stack can ship a single executable with embedded web assets and run the redirect path within budget.

- Monorepo skeleton, CI, lint rules that enforce hexagonal dependency direction.
- Spike A: `bun build --compile` produces one binary that serves the Elysia API, embedded React assets, and runs Kysely migrations on boot.
- Spike B: redirect handler p95 under target load on the binary, with Redis cache in front of Postgres.
- Spike C: Elysia 2 + Bun compatibility check for every library we depend on (Kysely driver, Redis client, queue library, auth).
- ADRs written for every decision in the blueprint's "Decisions" table.

**Gate:** all three spikes pass or we record a fallback ADR. Exit: a "hello world" binary that passes CI on macOS and Linux.

### M1 — Identity, organizations, and access (Connect Core, part 1)
**Hypothesis:** A publisher can sign up and invite a teammate without an authorization leak.

- Registration, email verification, login, sessions, password recovery, MFA for privileged roles.
- Organizations, memberships, invitations, scope checks at the authoritative boundary.
- Conformance focus: CT-001 to CT-005, CT-008. Tenant isolation tests are mandatory, not optional.

**Gate:** all identity conformance cases green; security review of auth flows completed.

### M2 — Publisher onboarding and property approval (Connect Core, part 2)
**Hypothesis:** Our manual review queue can clear publishers within the SLA at the expected volume.

- Publisher profile, KYB submission, reviewer queue, decision with reason.
- Website property registration and verification (DNS or meta tag), then compliance review.
- Conformance focus: CT-006, CT-007.

**Gate:** internal dogfood: ops team reviews ten synthetic publishers end-to-end with recorded decisions.

### M3 — Network connector and catalog (Connect Core, part 3)
**Hypothesis:** The first network's data is reliable enough to drive eligibility without manual patching.

- Connector for the chosen network: validate connection, discover advertisers and programs, resolve tracking destination, list transactions and adjustments.
- Capability profile published by the connector (what the network does not support is shown, not faked).
- Catalog sync with freshness watermark; eligibility decision with evidence.
- Conformance focus: CT-009, CT-010, CT-015.

**Gate:** sync runs against sandbox for 7 consecutive days with no silent approvals and every malformed payload quarantined.

### M4 — Links, safe redirect, click trace (Connect Core, part 4) — **first user-visible value**
**Hypothesis:** Publishers will create and use links through our redirect layer without reporting breakage.

- Link create / preview / edit / pause / revoke; bulk CSV with per-row results.
- Public redirect endpoint: eligibility and destination safety checks on every request, cache-backed, fail-closed on uncertainty.
- Click ingestion with at-most-once logical click facts.
- Conformance focus: CT-006, CT-010, CT-011, CT-013, CT-014.

**Gate (product):** 10 pilot publishers route real traffic for 4 weeks. Kill/continue metric: ≥70% of pilot publishers still have at least one active link at week 4, and zero unsafe-redirect incidents. If not met, we stop and re-scope before M5.

### M5 — Conversions and ledger (Finance, part 1: sandbox-accurate)
**Hypothesis:** Imported network transactions can be turned into correct, auditable publisher earnings with no double counting.

- Import batches with source identity and revision; replay safe.
- Attribution matching within the allowed window; unmatched conversions go to an exception queue.
- Share rules versioned; double-entry ledger with integer minor units.
- Statements (immutable) and publisher balance views separating estimated, approved, and available amounts.
- Conformance focus: CT-012, CT-016, CT-017, CT-018, CT-020.
- **Required:** property-based tests on the ledger (balance invariant, replay invariance, rounding conservation) before any statement UI.

**Gate (finance):** two independent reviewers (engineering and finance) sign the ledger invariants document; a month of sandbox data reconciles to the network's own report with zero unexplained variance.

### M6 — Settlement and payouts (Finance, part 2: real money)
**Hypothesis:** We can move publisher money safely, and an ambiguous payout is never paid twice.

- Settlement receipts matched to conversions; only matched, cleared funds become available.
- Payout methods via a provider adapter; minimum payout and hold periods as versioned policy.
- Payout state machine with `unknown` as a first-class state and a query-before-retry rule.
- Maker-checker approval for batches.
- Conformance focus: CT-019, CT-021, CT-022.

**Gate:** sandbox provider chaos test (timeouts, duplicate callbacks, out-of-order status) passes. Operators complete a payout dry run from runbook alone. Limited release with a manual cap per batch.

### M7 — Developer access (Connect Developer)
**Hypothesis:** Larger publishers will integrate if credentials are scoped and webhooks are reliable.

- Scoped API keys with rotation and revocation; rate limits; idempotency keys on all commands.
- Webhooks with signatures, test delivery, retries, and a delivery log.
- Asynchronous exports; cursor pagination everywhere.
- Conformance focus: contract, rate-limit, signature, pagination, idempotency suites.

**Gate:** a reference consumer app, built only from the public API docs, completes the report, webhook, and key-rotation flows with no undocumented behavior.

### M8 — Optimize beta (separate bet, legal gated)
**Hypothesis:** Opted-in publishers gain revenue from rewritten links without any unwanted rewrite.

- **Entry requires:** legal review of consent handling per target market, a CMP integration plan, and a clear product decision on the exclusion UI.
- Script install, consent gate, exclusions, policy routing, holdout experiments.
- Conformance focus: opt-out, consent denial, zero-unwanted-rewrite tests.

**Gate:** zero unwanted-rewrite incidents in beta; opt-out honored within the documented latency.

### M9 — Commerce expansion (deferred)
Product feeds and coupons only after licensing review. No date committed.

---

## 5. Sequencing principles

1. **Prove the redirect before building the money.** A broken redirect loses publishers today; a broken ledger loses money later, but a missing redirect means there is nothing to pay.
2. **Ledger invariants before ledger features.** Write the invariant tests in M5 before the statement UI exists.
3. **Ops tooling is product.** Review queues, exception queues, and replay tools ship with the feature they serve, not after.
4. **Fail closed on money and safety, fail open only on cosmetic data.** A stale eligibility check blocks a link; a stale chart shows a `data_stale` badge.
5. **No feature without its conformance cases.** A capability is not "done" until its CT-cases pass (spec §13).

---

## 6. Risks and mitigations

| # | Risk | Likelihood | Impact | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Network sandbox or API access arrives late and blocks M3 | Medium | High | Build against a recorded fixture simulator; keep the connector port stable so the real adapter drops in later. | Eng lead |
| R2 | Network data is incomplete (no adjustments, no settlement evidence) | Medium | High | Capability profile per connector; manual reconciliation queue; never fake support. | Eng lead |
| R3 | Redirect latency or availability regression | Medium | High | Redis-cached route views; load test in M0 and each release; fail-closed with a clear error page. | Platform |
| R4 | Ledger bug double-pays or drops commission | Low | Severe | Property tests; replay tests; balancing proof per statement; two-person review on share-rule changes. | Finance + Eng |
| R5 | Payout ambiguity (timeouts) causes duplicate transfers | Medium | Severe | Stable request identity; `unknown` state; query before retry; provider reconciliation job. | Finance + Eng |
| R6 | Consent or CMP rules violated in Optimize | Medium | Severe | Optimize gated behind legal review; zero-rewrite tests; default-off installs. | Legal + Product |
| R7 | Publisher fraud (click farms, self-clicks) | High | Medium | Click-level risk flags; holds before payout; appeal workflow; anomaly alerts. | Risk |
| R8 | Bun or Elysia 2 gap for a needed library | Medium | Medium | M0 compatibility spike; ADR with fallback (Node-compatible build path) before M1. | Eng lead |
| R9 | Scope creep back into "all channels, all countries" | High | High | Wedge is a written constraint; new channels require a gate review. | Product |
| R10 | Spec and code drift | Medium | Medium | Conformance cases executed in CI; spec changes require a version bump and a test diff. | Eng + QA |

---

## 7. Success metrics

| Stage | North-star / gate metric | Guardrail metrics |
|---|---|---|
| Wedge (M4) | ≥70% of pilot publishers keep ≥1 active link at week 4 | Redirect error rate < target; zero unsafe redirects |
| Finance (M5/M6) | Unexplained reconciliation variance = 0 for a full month | Ledger invariant failures = 0; payout ambiguity resolved within SLA |
| Developer (M7) | Reference consumer completes all flows from public docs alone | Webhook delivery success; API error rate per endpoint |
| Optimize (M8) | Revenue uplift on opted-in publishers | Unwanted-rewrite incidents = 0; opt-out honored |

Targets for the numeric guardrails (latency, error rate, SLA hours) are set in M0 spikes and recorded as configurable policy with a version (spec §4.5).

---

## 8. Team and operating model (assumptions to confirm)

Assumed: a small product team with one product manager, one designer, a staff-level tech lead, and 3–4 product engineers. Adjust milestone sizing once confirmed.

- **Definition of done:** conformance cases green, tests at each layer (see blueprint §6), telemetry and audit events present, an ADR for any decision that changes an invariant.
- **Review cadence:** weekly gate review per active milestone; any money or authorization change needs a second reviewer.
- **Release cadence:** trunk-based, continuous deploy to staging; production releases gated per milestone.

---

## 9. Questions (decided or open; open ones need a decision, not more research)

Question 1 is decided and stays listed so the numbering that other docs cite still holds.

1. **Which affiliate network is first?** Decided: Rakuten Advertising (ADR-013). WP-4.3 must verify the criteria this question named: API coverage, program breadth, and fit with the redirect model.
2. **Which country and currency for the wedge?** Recommend the country where the first network settles in its own currency, to avoid FX in M5.
3. **Who runs publisher review in M2?** Recommend an internal ops hire or contractor, not automation.
4. **Which payout methods must publishers be able to use at launch?** Needed before M6; the payout adapter contract must exist from M5.
5. **Redirect latency target and availability SLO?** Needed before M0 Spike B can pass or fail.
6. **Is Optimize a committed roadmap item or an option?** Affects whether we spend M8 legal budget now.
7. **Stale spec reference:** UI-036 names "Go" for the redirect endpoint. The blueprint chooses Bun/Elysia for everything. Recommend updating UI-036 to be stack-neutral (spec precedence rule applies). Confirm before editing the spec.

---

## 10. Immediate next steps (next two weeks)

1. Decide open questions 1, 2, and 5 (owners: product, platform).
2. Create the monorepo skeleton and CI per blueprint §2 and §8.
3. Run Spikes A–C; write ADRs 001–006.
4. Import conformance cases CT-001 … CT-022 as failing test stubs, tagged by milestone.
5. Draft the ledger invariants document (for M5) for finance review, even though code is later.
