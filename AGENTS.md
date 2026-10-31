# Moneytrap agent workflow

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it **before** grep/find or reading files when you need to understand or locate code:

- Use `codegraph_explore` when available. It returns the relevant symbols' current, line-numbered source and call paths. Name a file or symbol to read its source.
- The shell equivalent is `codegraph explore "<symbol names or question>"`.

If there is no `.codegraph/` directory, skip CodeGraph entirely. Indexing is the user's decision.

## Work-package sequence

**1. Select the work packages**
- Check the implementation plan, the Linear status, dependencies, and existing threads.
- Build the set of eligible packages: every WP issue or sub-issue whose Linear status is Todo or Backlog and whose dependencies are merged to `main`. Include sub-issues of any parent, across waves and lanes.
- Start every eligible package, not just one. Packages with no unmerged dependency between them can run in parallel.
- Defer a package that shares a file or port with an open package until that package merges.
- Packages that touch shared hot files merge one at a time. Hot files include `packages/adapter-postgres/src/migrations/index.ts` and the `contracts/` package. A later package rebases before it merges.
- Match each Linear issue to its WP ID, and put the WP ID in the issue title, so the match is unambiguous.
- Move each Linear issue to In Progress before starting it, so no one else picks it up.

**2. Start an isolated branch**
- Branch from updated `main` as `wave-<n>/<WP-id>-<slug>`, one work package per branch.
- Write the failing check first, then the implementation.

**3. Implement and check locally**
- Run `check:docs`, `typecheck`, `lint`, `boundaries`, and `bun test`.
- Commit with a Conventional Commit subject that includes the Linear ID. Use `Refs OZE-<id>` on interim commits and `Closes OZE-<id>` on the completing commit.
- No co-author or generated-by trailers in commit messages or PR bodies. Run `git log -1 --format=%B` before pushing and remove any trailer a tool added.

**4. Open one PR to `main`**
- One PR per work package, targeting `main`.
- The PR body starts with the WP ID (for example `WP-2.3`), then `Closes OZE-<id>`, where `OZE-<id>` is that package's Linear ID.
- If a package depends on a PR that is not merged yet, watch that PR and wait for it to merge. Never stack on an unmerged branch.
- Link the PR to the thread, and watch it while it waits on checks or reviews.

**5. Run the delegated review loop**
- Start a read-only, full-diff review with `gpt-6-sol` at low effort. If it hits its usage limit, fall back in this order: haiku 5.5 low, then codex gpt-6-luna low, then copilot gpt-6-luna low.
- Run at most three reviews at once across all threads. Start the next review when one finishes. Each package still gets its own review.
- Run every reviewer with full-access permission, and keep it read-only in the brief.
- Use the comment formats in `docs/MONEYTRAP_REVIEW.md`. The main review comment starts with `<!-- ccr-overview-v2 -->`. Each inline thread starts with `### [High | Medium | Low] <Issue title>`.
- **Finance review.** A package that is labeled `needs-finance-review`, or that changes `domain/src/ledger`, `domain/src/payouts`, `domain/src/access`, or `app/src/identity`, also gets a finance review. Run it with the same rules as the code review: read-only, full-access, counted in the three-review limit, and the same usage-limit fallback order. Its brief covers double-entry, immutability, linkage, money as bigint minor units, audit events, and tests for the done-when criteria. It reports APPROVE or REQUEST CHANGES with numbered findings, each marked blocking or non-blocking. The implementing thread fixes the findings and reruns both reviews on the new head.

**6. Triage every thread**
- Reply to each thread with `fix`, `incorrect`, or `won't fix`, and give the reason and the commit.
- Fix the valid findings, resolve each thread, and rerun the full-diff review on the new head.
- Repeat until the review is clean and no threads are open.
- Once every detailed thread is addressed and the review is clean, hide the main review comment as outdated. Do not hide it while any thread is still open.

**7. Merge and close**
- Merge only when checks pass, no threads are open, and any required finance review has approved, using rebase-merge.
- Unwatch the PR once it merges.
- Set the Linear issue to Done.

**8. Start the unblocked packages**
- Before the thread settles, check existing threads for duplicates.
- Re-run step 1 after each merge. Start every package that the merge has unblocked, each in its own thread.
- Packages with no dependency between them merge in the order they become ready: the first one with a clean review and passing checks merges first. The package that merges second rebases onto updated `main`, reruns its checks, and reruns the full-diff review on the rebased head before it merges.
- Loop the work package sequence until no eligible package remains.
