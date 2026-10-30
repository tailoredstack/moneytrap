# ADR-009: Better Auth for authentication, organizations, two-factor, and API keys

- Status: Accepted, 2026-10-31
- Date: 2026-10-31
- Spike: WP-0.7 (library compatibility)

## Context

Blueprint §1 selects Better Auth for email and password, sessions, verification, password reset, two-factor (TOTP and backup codes), organization invitations and memberships, and API keys. Those are the riskiest parts to hand-roll. Authorization uses Better Auth's organization access control for role-to-permission mapping (Blueprint §1).

## Decision

- Use `better-auth@1.7.14` with the Kysely adapter on Postgres, and the `@better-auth/api-key@1.7.14` plugin.
- Mount the Better Auth handler on Elysia (ADR-002).
- Schema and migrations come from `better-auth/db/migration` (`getMigrations`) at the same version, and run through the Kysely migrator (ADR-003). The `@better-auth/cli` package has no 1.7.x release, so the CLI cannot generate them.
- Enable `enableSessionForAPIKeys: true`. Keys are checked through `x-api-key` on authenticated routes. The plugin has no verify endpoint.
- Map roles to permissions with the organization plugin's access control. The domain `can()` wrapper calls it (Blueprint §1).

## Evidence

WP-0.7 results, passing under `bun test` and in the compiled binary:

- Sign-up and session through the Elysia mount.
- Organization plugin: creates an organization.
- Two-factor plugin: enables TOTP.
- API key plugin: a key resolves a session through `x-api-key`.

## Known behavior

- Better Auth logs `Database schema mismatch` on a fresh database before migrations run. This is expected. `--migrate` creates the tables.

## Fallback

Hand-rolled auth is out of scope. If a plugin breaks on upgrade, stay on the last working 1.7.x patch and pin it. If Better Auth itself is abandoned or fails a later check, an alternative must be named in a new ADR before the auth work package (WP-2.2) starts.
