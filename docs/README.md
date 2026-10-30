# Moneytrap — Documentation index

Start here. Everything needed to begin building is in this folder.

| Read first | What it is |
|---|---|
| [Project plan](MONEYTRAP_PROJECT_PLAN.md) | Product wedge, users, milestones M0–M9, risks, open product questions |
| [Implementation blueprint](MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md) | Stack, repo layout, actions/queries model, auth and permissions, test layers, ADR list, first two weeks |
| [Implementation plan](implementation/IMPLEMENTATION_PLAN.md) | Work packages WP-0.1 … WP-9.7 with paths, dependencies, and done-when criteria |
| [Waves](implementation/WAVES.md) | How work packages group into waves and parallel lanes, with the critical path |
| [Decision records](adr/README.md) | ADR-001 … ADR-011 with status, evidence, and fallbacks |
| [Test plans](test-plans/README.md) | One test plan per wave, test IDs `TP-W<wave>-<nnn>` |
| [UI skeletons](ui/SKELETONS.md) | Layout wireframes for the screens, by wave |

## Reference (behavior source of truth)

[Legacy specification set](legacy/) — implementation-neutral. Where it conflicts with the plan, the spec governs and the conflict goes to the plan's open questions.

- [Technical specification](legacy/MONEYTRAP_TECHNICAL_SPECIFICATION_COMPLETE.md)
- [Use cases](legacy/MONEYTRAP_USE_CASES.md) · [API operations](legacy/MONEYTRAP_API_OPERATIONS.md) · [Data model](legacy/MONEYTRAP_LOGICAL_DATA_MODEL.md)
- [UI experiences](legacy/MONEYTRAP_UI_EXPERIENCES.md) · [Interaction contracts](legacy/MONEYTRAP_INTERACTION_CONTRACTS.md) · [Conformance cases](legacy/MONEYTRAP_CONFORMANCE_CASES.md)

## Before you start

1. Run the doc checker: `bun scripts/check-docs.ts` (from the repo root). It must pass.
2. Open the Wave 0 test plan and the first wave's work packages.
3. Spikes A–C in Wave 0 decide the remaining technical risks. Do them first.

## Open decisions blocking specific waves

| Decision | Blocks | Owner |
|---|---|---|
| First affiliate network (plan Q1) | WP-4.3, Wave 4 real adapter | Product |
| Launch country and currency (plan Q2) | Wave 6 FX scope | Product |
| Load profile and latency SLO (plan Q5, WP-0.10) | Spike B pass or fail | Product + Platform |
| Optimize in scope for the year (plan Q6) | Wave 9 | Product |
| Better Auth + Kysely verified (ADR-009) | Resolved 2026-10-31 (accepted) | Eng lead (spike C) |
| Frontend bundler: Vite confirmed (ADR-008) | Resolved 2026-10-31; embedding gate at WP-1.14 | Eng lead (spike A) |

## Working conventions

- Project skills live in `.claude/skills/`: `moneytrap-architecture`, `moneytrap-auth`, `moneytrap-frontend`, `moneytrap-doc-consistency`.
- ADRs live in `docs/adr/`. ADR-001 … ADR-011 were accepted in WP-0.8; the index is `docs/adr/README.md`.
