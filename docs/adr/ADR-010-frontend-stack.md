# ADR-010: Frontend stack, shadcn/ui, TanStack, and Vite

- Status: Accepted, 2026-10-31
- Date: 2026-10-31
- Spike: none. The frontend stack was not part of spikes A to C.

## Context

Blueprint §1 selects accessible components, typed routing and search params, server-state caching, tables for ledger and link lists, and typed forms validated with the same TypeBox schemas as the server.

## Decision

- **UI components:** shadcn/ui on Tailwind CSS and Radix primitives. Components are copied into `packages/ui`, not installed as a black box, so the source is ours.
- **Routing:** TanStack Router, file-based, with typed search params. Route guards read the session before render. Server authorization still applies; client guards are UX only.
- **Server state:** TanStack Query, with cache invalidation after actions.
- **Tables:** TanStack Table with the shadcn Data Table.
- **Forms:** TanStack Form, validated with TypeBox schemas from `packages/contracts`.
- **Build:** Vite (ADR-008).

## Evidence

No spike ran these libraries. The first web work package (WP-1.14, web shell) is the first verification. It must show a typed route with a search param, a query, and a form that validates through `packages/contracts`.

## Consequences

- Each library sits behind a component or hook boundary. Replacing one touches `packages/ui` or `apps/web/src/api`, not the domain or the app.

## Fallback

If one library fails its verification, replace only that library at its boundary, and record the replacement in this file with a date. Replacing the whole stack needs a new ADR.
