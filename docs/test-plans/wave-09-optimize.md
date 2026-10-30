# Test Plan — Wave 9: Optimize beta

**Scope:** WP-9.0 to WP-9.7 · **Milestone:** M8 (legal-gated) · **Plan index:** [README](README.md)
**Test IDs:** `TP-W9-###`

## 1. Objective

Opted-in publishers get consent-aware, policy-controlled link rewriting. Zero unwanted rewrites. Opt-out is honored within the documented latency. Nothing rewrites without every gate passing.

## 2. Entry criteria

- WP-9.0 legal and consent gate signed (ADR recorded).
- Wave 5 gate passed (links and route view stable).
- CMP test harness available (test CMP that can return granted, denied, unknown).

## 3. Test matrix

### 3.1 Consent and gates

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W9-001 | Consent granted | Rewrite gate passes (other gates also pass) | WP-9.1 |
| TP-W9-002 | Consent denied | No rewrite | WP-9.1 |
| TP-W9-003 | Consent unknown or CMP unreachable | No rewrite (fail closed) | WP-9.1 |
| TP-W9-004 | Installation not enabled | No rewrite regardless of consent | WP-9.2 |
| TP-W9-005 | Property not approved | No rewrite | WP-9.2 |
| TP-W9-006 | Property-based: every gate combination | Rewrite only when all gates pass | WP-9.2 |
| TP-W9-007 | Default install state | Disabled; zero rewrites on a page with 100 links | WP-9.2 |

### 3.2 Installation

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W9-008 | Install state machine: disabled → configured → eligible → enabled | Each transition guarded | WP-9.3 |
| TP-W9-009 | Enable from `configured` without eligibility | Rejected | WP-9.3 |
| TP-W9-010 | SDK loaded before consent | No DOM changes; no network calls except the consent check | WP-9.3, §4.4 |
| TP-W9-011 | Health check with missing CMP | Shows `blocked` with reason | WP-9.3 |

### 3.3 Rules, decisions, experiments

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W9-012 | Rule version published | Historical decisions unchanged | WP-9.4 |
| TP-W9-013 | Rule preview on sample page | Shows exact changes; no live effect | WP-9.4 |
| TP-W9-014 | Route decision stores reasons | Each decision has reasons array | WP-9.5 |
| TP-W9-015 | Explanation UI matches stored reasons | Text matches | WP-9.5 |
| TP-W9-016 | Holdout assignment for same visitor | Stable across sessions per policy | WP-9.6 |
| TP-W9-017 | Holdout visitors | Never rewritten; counted as holdout | WP-9.6 |
| TP-W9-018 | Experiment health with insufficient traffic | `not enough data` state, not a result | WP-9.6 |

### 3.4 Opt-out and exclusions

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W9-019 | Publisher excludes a domain | No rewrite on that domain | WP-9.7 |
| TP-W9-020 | Visitor opts out via CMP mid-session | Rewrites stop on next navigation; opt-out latency ≤ documented value | WP-9.7 |
| TP-W9-021 | Exclusion list updated | Applied before next rewrite; cache invalidated | WP-9.7 |
| TP-W9-022 | Exclusion and rule conflict | Exclusion wins | WP-9.7 |

### 3.5 Screens and E2E

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W9-023 | Script deployment wizard, copy snippet | Snippet copied; confirmation announced | WP-9.3 |
| TP-W9-024 | Rules editor with invalid rule | Field error; previous version still active | WP-9.4 |
| TP-W9-025 | CMP settings screen | No raw consent data displayed | WP-9.1 |
| TP-W9-026 | E2E on test site: install, consent, rewrite, opt-out | Expected rewrite and no rewrite at each step | WP-9.3 to 9.7 |

### 3.6 Audit

| ID | Scenario | Expected | Refs |
|---|---|---|---|
| TP-W9-027 | Rule change | Audit row with actor and reason | WP-9.4 |
| TP-W9-028 | Enable/disable installation | Audit row | WP-9.3 |

## 4. Exit criteria

- Legal gate signed (WP-9.0).
- All TP-W9 green.
- Zero unwanted rewrites in beta (Project plan M8 gate), measured by a monitored beta with rewrite logs compared to consent logs.
- Opt-out latency measured and documented.

## 5. Test data

- Test site with 100 links, consent configurations: granted, denied, unknown, CMP down.
- Visitor fixtures: opted out, holdout, normal.

## 6. Risks

- Legal scope may change target markets; test matrix must be re-run per market with the market's consent rules.
- Browser differences in consent signal handling. Test in the browsers listed in the legal decision.
