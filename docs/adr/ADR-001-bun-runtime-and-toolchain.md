# ADR-001: Bun as runtime, package manager, test runner, and binary builder

- Status: Accepted, 2026-10-31
- Date: 2026-10-31
- Spike: WP-0.5 (binary shape), WP-0.7 (library compatibility)

## Context

Moneytrap ships one executable with the server, the built web assets, and the migration set (Blueprint §1). A second runtime or build pipeline would add tools to maintain for the same artifact.

## Decision

Use Bun for everything: runtime, package manager (`bun install --frozen-lockfile`), test runner (`bun test`), and the compiled binary (`bun build --compile`). Pin Bun 1.4.4 in `package.json` (`packageManager`) and in CI.

## Evidence

- Spike A (WP-0.5, PR #12) built one executable that serves an Elysia route and an embedded page and runs `--migrate`.
- Spike C (WP-0.7) passed every library check under `bun test` and in the compiled binary, on macOS arm64 with Bun 1.4.4.
- CI runs `check:docs`, `typecheck`, `lint`, `boundaries`, `bun test`, and `build:binary` on Ubuntu and macOS.

## Consequences and gates

- The compiled binary is the release artifact. The runtime needs no Bun installed.
- Acceptance assumes the Linux run of the compiled-binary checks passes. That run is still open (TP-W0-019). It must be recorded before the first release build.

## Fallback

If the compiled binary cannot run on a supported OS and the problem cannot be fixed inside a spike's time-box, move the build to Node.js with its single-executable tooling. That changes the runtime, test runner, and spikes, so it needs a new ADR.
