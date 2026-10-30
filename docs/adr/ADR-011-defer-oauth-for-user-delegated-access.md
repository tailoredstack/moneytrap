# ADR-011: Defer OAuth 2.0 for user-delegated client access; M7 ships org-scoped API keys only

- Status: Accepted, 2026-10-31 (decision to defer)
- Date: 2026-10-31
- Spike: WP-0.7 (API key plugin)

## Context

Third-party clients may need to act for a user. OAuth 2.0 would handle that with consent, scopes, and revocable tokens. Building it adds an authorization server to maintain. M7 needs only organization-scoped machine access, and the API key plugin covers that (ADR-009).

## Decision

- Do not build OAuth 2.0 for user-delegated client access in M0 to M7.
- M7 ships organization-scoped API keys only, through the Better Auth API key plugin (ADR-009).

## Evidence

WP-0.7: the API key plugin resolves a session through `x-api-key` under both `bun test` and the compiled binary. No OAuth spike was run, because the decision is to defer it.

## Revisit trigger

Reopen this decision before any partner or customer needs user-delegated access, and no later than the start of M7 planning. The new ADR must choose a library and record a spike.

## Fallback

If a partner needs user-delegated access before M7, the team takes that as a new decision. This ADR is superseded by a new one, and the OAuth work runs as its own work package.
