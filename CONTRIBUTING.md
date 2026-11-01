# Contributing to Moneytrap

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/) with the Linear issue reference at the end of the subject:

```
feat(identity): register and verify email #OZE-3123
```

Format:

```
<type>(<scope>): <brief descriptive message> #<LINEAR_ID>
```

- **type:** `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`, `build`.
- **scope:** the area touched, matching a module or wave: `domain`, `app`, `server`, `web`, `contracts`, `identity`, `ledger`, `docs`, `ci`.
- **brief descriptive message:** lowercase, imperative, no trailing period, under 72 characters.
- **LINEAR_ID:** the issue ID, for example `OZE-3123`. Use the work package's issue.

### Linking and closing the issue

Linear links a commit to an issue only when the message contains a magic word before the issue ID. The `#OZE-3123` in the subject is a reference for humans, not a link. Add a footer:

```
feat(identity): register and verify email #OZE-3123

Refs OZE-3123
```

- `Refs OZE-3123` links the commit. Linear can move the issue through its configured pre-merge statuses.
- `Closes OZE-3123` links the commit and applies the status Linear is configured to use on merge, usually Done.

Commit linking needs a one-time setup in Linear's GitHub settings: enable **Link commits to issues with magic words**, then add the webhook Linear provides. An admin does this once per workspace.

With rebase-merge, each commit lands on `main` with its message, so Linear reads the footer there. Put `Closes` on the commit that completes the work package. Use `Refs` on the others.

### Breaking changes

Add `!` after the scope and a `BREAKING CHANGE:` footer:

```
feat(contracts)!: change money encoding to decimal string #OZE-3114

BREAKING CHANGE: amounts are now encoded as decimal strings, not integers.
Closes OZE-3114
```

## Branches

`wave-<n>/<WP-id>-<slug>`, for example `wave-02/WP-2.3-register-verify`. One work package per branch.

## Pull requests

- One work package per PR.
- No stacked PRs. Every PR targets `main`. Open the next PR only after the previous one has merged, and branch it from the updated `main`.
- Body starts with the WP ID and `Closes OZE-<id>`.
- Squash is off. Use rebase-merge so each commit keeps its message on `main`.
- Do not add co-author or generated-by trailers.
- Checks that must pass before merge: `bun run check:docs`, `bun run check:drift` (a spec or contract change needs a version bump), plus `bun run typecheck` once WP-0.1 has merged. Once WP-0.2 and WP-0.3 have merged, lint, boundary rules, the wave's tests, and the binary build on macOS and Linux must pass too. The implementation plan's definition of done requires them for every work package.
