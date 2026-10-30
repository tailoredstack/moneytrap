# Moneytrap agent workflow

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it **before** grep/find or reading files when you need to understand or locate code:

- Use `codegraph_explore` when available. It returns the relevant symbols' current, line-numbered source and call paths. Name a file or symbol to read its source.
- The shell equivalent is `codegraph explore "<symbol names or question>"`.

If there is no `.codegraph/` directory, skip CodeGraph entirely. Indexing is the user's decision.

## Work-package sequence

1. Check the implementation plan, Linear issue state and dependencies, repository state, and existing threads. Select a work package only when its Linear status is Todo or Backlog and all dependencies are satisfied. Avoid duplicate work packages.
2. Immediately move the selected Linear issue to In Progress before implementation so other workers do not select it. Start each work package in its own branch and worktree from updated `main`. When two independent eligible work packages can proceed in parallel, keep two implementation threads active in separate worktrees.
3. Follow `CONTRIBUTING.md`. Implement the work package's definition of done and run the relevant checks locally.
4. Create one pull request per work package targeting `main`. Do not stack pull requests. A parallel work package may be implemented in its own worktree, but its PR must wait until the preceding PR merges and its branch is updated from `main`.
5. Request a read-only, full-diff delegated review using `gpt-6-sol` with medium reasoning. Post its findings as inline threads in one `gh api` review headed exactly:

   `Pull Request Review by gpt-6-sol (medium reasoning) in behalf of @joseederangojr`

6. Triage every finding in its thread. Reply with `fix`, `incorrect`, or `won't fix` and a reason. Fix valid findings, then resolve the threads. Repeat the full-diff delegated review on the new head until it passes cleanly and no review threads remain open.
7. Stage only specific intended paths. Use Moneytrap Conventional Commits with the Linear issue ID in the subject. Use `Refs OZE-<id>` on interim commits and `Closes OZE-<id>` on the final commit. Do not add co-author or generated-by trailers.
8. Once required checks pass and review threads are closed, merge with `gh pr merge --rebase`. Set the Linear issue to Done.
9. Before settling, start the next eligible work package in a new thread, after checking existing threads. Keep the parallel implementation rule above in effect.
