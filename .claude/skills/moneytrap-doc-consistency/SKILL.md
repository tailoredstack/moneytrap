---
name: moneytrap-doc-consistency
description: Use after any edit to Moneytrap docs (docs/) or code conventions, and when reviewing a change for consistency. Runs the doc checker, turns repeated review findings into new checks, and keeps IDs, links, and wave plans in sync.
---

# Moneytrap doc consistency

## Run it

```
bun scripts/check-docs.ts
```

Exit 0 means every relative link resolves, every UC/API/DM/UI/CT/WP/TP reference points at a defined ID, and no ID is defined twice. Run it after every docs change. Do not mark docs work done while it fails.

## Spec drift

```
bun run check:drift
```

Compares the branch against `$BASE_SHA` (or `origin/main`). A change under `docs/legacy/` needs a higher `**Version:**` in the technical specification. A non-test change in `packages/contracts/src` needs a higher `version` in `packages/contracts/package.json`. Conformance tests that name a changed CT row, and any changed conformance test, are run and must be green. A bump needs numeric parts (`2.1`, not `2.1-rc1`). Pass `--skip-conformance` to skip the test run.

## The feedback loop

1. **Notice.** When a review, test failure, or your own edit fixes the same kind of mistake a second time, it is a pattern.
2. **Check first.** Add a rule to `scripts/check-docs.ts` that would have caught it. Prove it with a negative test: create a bad file, confirm the checker fails, delete the file.
3. **Codify second.** If the pattern is about *how to write* something rather than a broken reference, add it to the matching skill (`moneytrap-architecture`, `moneytrap-frontend`, `moneytrap-auth`), not to this one.
4. **Retire.** If a rule has never fired and its source decision has changed, remove it and say why in the commit.

Keep the loop small: one new check or one skill line per repeated mistake. Do not pre-write rules for mistakes that have not happened.

## What the checker covers today

- Relative links in all docs.
- Legacy IDs: `UC##`, `API-###`, `DM-###`, `UI-###` (headings) and `CT-###` (table rows) in `docs/legacy/`.
- Work packages: `WP-<wave>.<n>` rows in `docs/implementation/IMPLEMENTATION_PLAN.md`; duplicates fail.
- Test IDs: `TP-W<wave>-<nnn>` rows in `docs/test-plans/`; duplicates across files fail.

## What it does not cover yet (add when a mistake repeats)

- Skeleton coverage: a UI ID listed in the plan but missing from `docs/ui/SKELETONS.md`.
- Wave gates: a wave in `WAVES.md` without a test plan.
- Stale stack terms (for example, "Argon2id" or "repository" after ADR-006 and ADR-009 changed them).
- Code-level checks once code exists: guard coverage per route, dependency-cruiser rules, OpenAPI diff.

## Ground rules

- Legacy specs under `docs/legacy/` are the behavior source. Do not edit them to match the plan; if they conflict with the plan, record the conflict in the plan's open questions.
- Keep IDs stable. Retire a test ID by marking it `retired` with a reason, never by reusing it.
