# Moneytrap agent workflow

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it **before** grep/find or reading files when you need to understand or locate code:

- Use `codegraph_explore` when available. It returns the relevant symbols' current, line-numbered source and call paths. Name a file or symbol to read its source.
- The shell equivalent is `codegraph explore "<symbol names or question>"`.

If there is no `.codegraph/` directory, skip CodeGraph entirely. Indexing is the user's decision.

## Work-package sequence

**1. Select the work packages**
- Check the implementation plan, the Linear status, dependencies, and existing threads.
- Work one wave at a time. The current wave is the lowest-numbered wave that still has a package in Todo or Backlog. Only packages in the current wave start.
- A wave's stragglers may keep running alongside the next wave. A straggler is a package already In Progress when the wave has no Todo or Backlog package left to start.
- Packages in the next wave start only when their dependencies are merged.
- Build the set of eligible packages: every WP issue or sub-issue in the current wave whose Linear status is Todo or Backlog and whose dependencies are merged to `main`. Include sub-issues of any parent within that wave.
- Within the current wave, run every unblocked sub-issue in parallel. Only blocked packages wait.
- Packages that share a file or port do not run in parallel. Hot files include `packages/adapter-postgres/src/migrations/index.ts` and the `contracts/` package. The later package waits until the earlier one merges, then rebases before it merges.
- Match each Linear issue to its WP ID, and put the WP ID in the issue title, so the match is unambiguous.
- Before launching, read the package's done-when criteria against its test plan. If they need persistence or other work outside the listed "Depends on", that work is a dependency too. Fix the plan or Linear first, or hold the package.
- Move each Linear issue to In Progress before starting it, so no one else picks it up.

**2. Start an isolated branch**
- Branch from updated `main` as `wave-<n>/<WP-id>-<slug>`, one work package per branch.
- Docs-only changes use `docs/<slug>` instead.
- Write the failing check first, then the implementation.

**3. Implement and check locally**
- Run `bun install` once per worktree before the checks.
- Run `check:docs`, `typecheck`, `lint`, `boundaries`, and `bun test`.
- If CI fails, pull the failing job's logs. Re-run failures that look transient (timeout, runner died, network). Fix real failures before triage.
- If a job fails in seconds with no steps run and no runner name, it never started. That is a GitHub-side failure. Re-run it once with `gh run rerun <run-id> --failed`. If it fails again, compare with a passing branch before changing code. If a throwaway branch from `main` fails the same way, the cause is GitHub-side (runner availability or account limits). Do not change code. Re-run later and tell the user.
- Commit with a Conventional Commit subject that includes the Linear ID. Use `Refs OZE-<id>` on interim commits and `Closes OZE-<id>` on the completing commit.
- No co-author or generated-by trailers in commit messages or PR bodies. Run `git log -1 --format=%B` before pushing and remove any trailer a tool added.

**4. Open one PR to `main`**
- One PR per work package, targeting `main`.
- The PR body starts with the WP ID (for example `WP-2.3`), then `Closes OZE-<id>`, where `OZE-<id>` is that package's Linear ID.
- If a package depends on a PR that is not merged yet, watch that PR and wait for it to merge. Never stack on an unmerged branch.
- Link the PR to the thread, and watch it while it waits on checks or reviews. Each package's own thread watches its own PR. The coordinating thread does not watch child PRs.

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
- When the last package in a wave merges, the wave's exit gate in `docs/implementation/WAVES.md` must pass before the next wave starts.

**8. Start the unblocked packages**
- Check existing threads for duplicates before starting a package.
- Re-run step 1 after each merge. Start every package that the merge has unblocked, each in its own thread.
- Packages with no dependency between them merge in the order they become ready: the first one with a clean review and passing checks merges first. The package that merges second rebases onto updated `main`, reruns its checks, and reruns the full-diff review on the rebased head before it merges.
**Resource cleanup**
- Every process or container a step starts must be stopped before the step ends, including on failure. Use a `finally` block or an equivalent trap.
- Before ending a turn, list what this session started, such as Docker containers (`docker ps`), local servers, and background processes. Stop only what this session started. Leave anything you did not start.
- Use a unique container name and a free port for each test run. Don't reuse a port that another process holds.
- Remove temporary branches, worktrees, and probe files you created.

**Self-sufficiency**
- Resolve blockers from the repo docs and the transcript before asking the user. Ask only for decisions that are genuinely the user's.
- Improve this sequence as you go. When the same problem appears twice, add a rule for it here.

**Loop control**
- Before any thread ends its turn, the coordinating thread checks Linear for newly eligible packages and starts them. It doesn't settle while eligible work remains.
- The coordinating thread keeps a fallback wake-up scheduled, so the loop runs without a PR event.
- A thread waiting on a decision or an event stays in the waiting state and keeps its PR watched. It doesn't end its turn or unwatch.
- Keep Linear's blocked-by relations in sync with the plan's "Depends on" column.
- Set each Linear issue to Done when its PR merges, and check that every wave parent matches its children: Done when all children are Done, In Progress when any child is In Progress, otherwise Todo.
- Loop the work package sequence until no eligible package remains.
