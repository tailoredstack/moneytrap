# Frontend UX plan

## Goals and non-goals
Give the existing web screens a coherent, accessible visual system and close the deferred browser-a11y gaps. This plan does not redesign domain workflows, relax permissions, or change API behavior.

## Current state
`apps/web` is a Vite SPA: React 19.2, `@tanstack/react-router`, Tailwind 4 and Vite 8 (`apps/web/package.json`, `vite.config.ts`). Vite proxies `/api` to the Elysia server and rewrites `Origin`; the production server embeds the static SPA (`apps/server/src/assets.ts`). Screen components live under `apps/web/src/features/*`; the router already has typed search parsing (`src/app/router.tsx`). `packages/ui` has Button/Input/Form/Table/Toast primitives backed by Radix, CVA and Tailwind utilities. `docs/ui/SKELETONS.md` is the UI catalog; compare each implemented route and state against it, noting planned-but-unbuilt screens separately. `docs/ui/A11Y-AUDIT-W2-W3.md` records good DOM-level coverage and explicitly deferred real screen-reader, keyboard-browser and navigation-focus checks.

## Steps and work packages
1. **Inventory and baseline (S, 2–3 days):** map routed screens to catalog IDs and states; capture current screenshots; record mismatches and accessibility follow-ups.
2. **Tokens and primitives (M, 1 week):** adopt shadcn/ui patterns compatible with Tailwind 4, retaining `@moneytrap/ui` ownership; define semantic color/type/spacing/radius tokens, compact/default density, and light/dark themes. Avoid wholesale generated-component replacement.
3. **Shell and identity (M, 1 week):** apply shell, landing, login/recovery and account settings; preserve focus and error behaviors.
4. **Operational tables and forms (L, 2 weeks):** properties, review queue, audit, directory, balances, exceptions/imports and statements; each screen includes loading/empty/error/denied/stale states required by its spec.
5. **Visual regression and accessibility gate (M, 1 week):** add Playwright browser coverage and deterministic screenshot baselines for representative viewport/state pairs; review diffs on supported browsers. Add keyboard-only flows, route-change focus assertions and manual VoiceOver/NVDA sign-off. Keep the existing DOM checks.

Every screen PR must pass the established rules: named controls, unique contextual action names, linked errors, focus to first invalid field, explanatory disabled states, non-color status, live announcements, keyboard order, skip link and focus rings. No screen ships before its automated checks pass and new patterns get audit coverage.

## Skills and tooling
Installed skill check: `.claude/skills/moneytrap-frontend/SKILL.md` exists; `dataviz` and a built-in browser skill were not found in the checked installed-skill directories. `.mcp.json` configures CodeGraph only. No shadcn/design MCP server was verified; do not assume one. Recommend adding Playwright browser automation and optionally a design-system MCP only after selecting and verifying a provider. Use Playwright screenshots for visual regression, not as a substitute for screen-reader review.

## Risks
Token work can become a visual rewrite; constrain it to reusable primitives and representative screens. Dark mode can reduce contrast if semantic status colors are reused as decoration. Screenshot tests are brittle without fixed fonts, data, viewport and browser version. shadcn patterns are copied into the project, so upgrades need local ownership.

## Owner decisions (recommended defaults)
- Adopt semantic Tailwind 4 tokens and shadcn-style locally owned primitives? **Yes**, incrementally.
- Density options? **Default plus compact** for data-heavy operations.
- Dark mode? **Support system preference plus explicit user toggle**, after contrast review.
- Browser regression tooling? **Playwright**, with screenshots on a small stable screen/state matrix.
- Prioritize? **Shell/identity, then ops and finance tables**, gated per-screen by a11y.

## Linear packages to create
UX-1 catalog audit + baseline (S); UX-2 tokens/primitives (M); UX-3 shell and identity refresh (M); UX-4 operations and finance screens (L); UX-5 Playwright visual and keyboard accessibility gate (M). Dependencies in that order except UX-5 can start with UX-1.
