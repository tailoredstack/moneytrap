---
name: moneytrap-frontend
description: Use when building or changing Moneytrap's React UI. Covers shadcn/ui components, TanStack Router, Query, Table, and Form, plus the state and accessibility rules from the UI catalog.
---

# Moneytrap frontend

## Stack

- **Components:** shadcn/ui, copied into `packages/ui`. Edit the copy when we need changes; do not wrap it in a second design system.
- **Routing:** TanStack Router, file-based. Filters and pagination live in typed search params.
- **Server state:** TanStack Query. Mutations invalidate the queries they affect. Reads show `as_of` and `data_stale` from the API.
- **Tables:** TanStack Table with shadcn Data Table. Cursor pagination comes from the API, not client-side slicing of large sets.
- **Forms:** TanStack Form, validated with the TypeBox schemas from `packages/contracts`.
- **Build:** Vite. Output is embedded in the binary.

## Rules

- Client route guards are UX only. The server guard decides. A hidden button is not an authorization check.
- Money renders with currency and `as_of`. A failed or stale source is never shown as `0.00` (spec §8).
- Every screen implements loading, empty, populated, error, permission-denied, and stale states. Use the patterns in `docs/ui/SKELETONS.md` §10.
- Accessibility: labels on every control, errors announced through live regions, focus moved to the first error on submit, no colour-only status.
- Do not import server code. Shared types come from `packages/contracts`.
- Do not store tokens in `localStorage`. Auth uses Better Auth's cookie session.

## Testing

- Component tests for each state of each screen named in the wave test plan.
- Keyboard-only E2E path for each wave's pilot flow.
- Accessibility check (WP-X.5) at the end of each wave with UI.
