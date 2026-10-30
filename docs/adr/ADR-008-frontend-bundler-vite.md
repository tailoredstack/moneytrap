# ADR-008: Frontend bundler, Vite

- Status: Accepted, 2026-10-31
- Date: 2026-10-31
- Spike: WP-0.5 (binary shape)

## Context

The React web app must be embedded in the single binary (Blueprint §1). The choice was Bun's HTML bundler or Vite. Blueprint §1 already selects Vite, and §13 asks ADR-008 to confirm that choice using the spike A result.

## Decision

Build the React app with Vite. Its static output is embedded into the compiled binary by the same file-import mechanism that spike A used.

## Evidence

- Spike A (WP-0.5) built its React page with Bun's bundler (`Bun.build`, browser target) and embedded the output in the compiled binary. The binary served the page with no Bun installed at runtime.
- Vite emits static files, and the binary needs only static files. The embedding mechanism does not depend on which bundler produced them.
- Vite was chosen for its dev server and hot module replacement, and because the shadcn/ui, TanStack Router, and TanStack Query tooling documents Vite setups (ADR-010).

## Gate

Spike A did not run Vite, so the Vite embedding is unverified. WP-1.14 (web shell) must show that `bun run build:binary` embeds the Vite output and that the binary serves it with no Bun installed.

## Fallback

If the Vite output does not embed, or the gate fails, use Bun's HTML bundler, which spike A verified, and record that decision in this file with a date.
