---
name: moneytrap-auth
description: Use when working on authentication, sessions, two-factor, organizations, invitations, roles, or API keys in Moneytrap. Covers Better Auth configuration, the authenticate/authorize split in apps/server, and what not to hand-roll.
---

# Moneytrap auth

## Rules

- Better Auth owns credentials, sessions, email verification, password reset, two-factor, organizations, invitations, and API keys. Do not write custom hashing, token generation, or session code.
- Configuration lives in `apps/server/src/auth/config.ts`. Security settings are asserted in tests (TP-W2-004, TP-W2-005).
- Authentication (who is calling) happens in `apps/server/src/http/auth.ts`. Authorization (may they do this) happens in route guards in `apps/server/src/http/guards/`. Actions and queries do neither.
- Roles and permissions use Better Auth organization access control. `domain` exposes a pure `can(principal, permission, scope)` wrapper.
- Privileged routes check the session's recent second-factor time. Missing or stale assurance returns the step-up error code from the API catalog.
- API keys (WP-8.1) use the Better Auth API key plugin. Our code maps a key to a `Principal` and its scopes. We never store or log raw keys.
- Unknown and foreign resources return `RESOURCE_NOT_FOUND`, identical to missing ones.

## Before changing auth

1. Read the official Better Auth docs for the plugin version pinned in the repo. Community guides are not authoritative.
2. Check the Kysely adapter and CamelCase plugin setup in spike C notes (ADR-009).
3. Regenerate the schema with the Better Auth CLI and review the migration diff before committing.

## Tests to update with any auth change

- Guard coverage: every new route declares a permission (TP-W2-035).
- Config assertions for security defaults.
- No tokens or passwords in logs.

## Deferred

- OAuth 2.0 for user-delegated client access is deferred (ADR-011). Do not add it without an ADR.
