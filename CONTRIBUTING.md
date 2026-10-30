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

### Closing the issue

A bare `#OZE-3123` links the commit to the issue but does not close it. To close the issue when the PR merges, add a footer:

```
feat(identity): register and verify email #OZE-3123

Closes OZE-3123
```

With rebase-merge, each commit lands on `main` with its message, so the footer is what Linear reads. Put `Closes` on the commit that completes the work package.

### Breaking changes

Add `!` after the scope and a `BREAKING CHANGE:` footer:

```
feat(contracts)!: change money encoding to decimal string #OZE-3114

BREAKING CHANGE: amounts are now encoded as decimal strings, not integers.
```

## Branches

`wave-<n>/<WP-id>-<slug>`, for example `wave-02/WP-2.3-register-verify`. One work package per branch.

## Pull requests

- One work package per PR.
- Body starts with the WP ID and `Closes OZE-<id>`.
- Squash is off. Use rebase-merge so each commit keeps its message on `main`.
- Do not add co-author or generated-by trailers.
- CI must pass: `bun run check:docs`, typecheck, lint, boundary rules, tests.
