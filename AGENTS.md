# Moneytrap agent workflow

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it **before** grep/find or reading files when you need to understand or locate code:

- Use `codegraph_explore` when available. It returns the relevant symbols' current, line-numbered source and call paths. Name a file or symbol to read its source.
- The shell equivalent is `codegraph explore "<symbol names or question>"`.

If there is no `.codegraph/` directory, skip CodeGraph entirely. Indexing is the user's decision.

## Work-package sequence

**1. Select the work package**
- Check the implementation plan, the Linear status, dependencies, and existing threads.
- Pick a package only when its Linear status is Todo or Backlog and its dependencies are satisfied.
- Move the Linear issue to In Progress before starting, so no one else picks it up.
- You can start multiple open tasks that are not blocked

**2. Start an isolated branch**
- Branch from updated `main` as `wave-<n>/<WP-id>-<slug>`, one work package per branch.
- Write the failing check first, then the implementation.

**3. Implement and check locally**
- Run `check:docs`, `typecheck`, `lint`, `boundaries`, and `bun test`.
- Commit with a Conventional Commit subject that includes the Linear ID. Use `Refs OZE-<id>` on interim commits and `Closes OZE-<id>` on the completing commit.
- No co-author or generated-by lines.

**4. Open one PR to `main`**
- One PR per work package. a dependent PR waits until its predecessor merges.
- The body starts with the WP ID and `Closes OZE-<id>`.
- Link the PR to the thread, and watch it while it waits on checks or reviews.

**5. Run the delegated review loop**
- Start a read-only, full-diff review with `gpt-6-sol` at low effort. If it hits its usage limit, fall back to haiku 5.5 at low effort, then to the other reviewers in your usage-limit order.
- Run every reviewer with full-access permission, and keep it read-only in the brief.
- The review posts inline threads under the exact header the workflow specifies.
- Review comment template `docs/MONEYTRAP_REVIEW.md`

**6. Triage every thread**
- Reply to each thread with `fix`, `incorrect`, or `won't fix`, and give the reason and the commit.
- Fix the valid findings, resolve each thread, and rerun the full-diff review on the new head.
- Repeat until the review is clean and no threads are open.
- If every thread is addressed then hide the main comment as outdated

**7. Merge and close**
- Merge only when checks pass and no threads are open, using rebase-merge.
- Set the Linear issue to Done.

**8. Start the next package**
- Before the thread settles, check existing threads for duplicates.
- Start the next eligible package in its own thread.
- And loop the work package sequence
