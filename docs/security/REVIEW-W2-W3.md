# Security review: identity, access, publisher and property (W2 and W3)

Work package: WP-X.1 (OZE-3216). Scope: identity and access code merged to main in Wave 2, and publisher and
property code merged in Wave 3, reviewed for authorization, state-transition, and data-exposure defects.
Reviewed at origin/main `6006e38`.

Gate: `docs/implementation/WAVES.md` requires no open high-severity findings at the end of W2. **One high finding is
open (SEC-W2-001), so the gate is not met.** OZE-3216 stays In Progress until it is fixed or accepted.

## Method

- Read the route guard table, the `decide`/`can` policy, the Better Auth hook layer, sessions and password routes,
  rate limits, the Wave 3 publisher and property use cases, and the Postgres adapters that write their state.
- Verified the one high finding against the installed Better Auth source (`better-auth@1.7.14`,
  `dist/api/routes/update-user.mjs`, `changePassword`).
- Baseline before the review: `check:docs`, `typecheck`, `lint` (warnings only), `boundaries`, and `bun test`
  (610 pass, 0 fail, 147 skipped). The skipped tests need Postgres and Redis, so the integration paths below were
  read but not run.

## Findings

| ID | Severity | Location | Status |
| --- | --- | --- | --- |
| SEC-W2-001 | High | `apps/server/src/auth/config.ts:301` | Open (OZE-3233) |
| SEC-W2-002 | Medium | `apps/server/src/auth/rate-limit.ts:102` | Deferred |
| SEC-W3-001 | Medium | `packages/app/src/publisher/submit-kyb.ts:15` | Deferred (latent) |
| SEC-W3-002 | Medium | `packages/app/src/properties/suspend.ts:72` | Deferred (latent) |
| SEC-W2-003 | Low | `apps/server/src/http/auth.ts:37` | Deferred |
| SEC-W3-003 | Low | `packages/app/src/properties/verify.ts:145` | Deferred |
| SEC-W3-004 | Low | `packages/adapter-postgres` (no property review adapter) | Deferred |
| SEC-W2-004 | Low | `packages/domain/src/access/permissions.ts:62` | Accepted |
| SEC-W2-005 | Low | `packages/domain/src/access/permissions.ts:68` | Accepted |
| SEC-W2-006 | Low | `apps/server/src/auth/config.ts:232` | Accepted |

No high findings other than SEC-W2-001 were found.

### SEC-W2-001 (High): MFA can be disabled after a password change, without a second factor

- **Location:** `apps/server/src/auth/config.ts:301` (`requireStepUpToDisableMfa`).
- **Impact:** The step-up reads the session's `createdAt` as the time of the second factor. Better Auth's
  `changePassword` with `revokeOtherSessions: true` calls `createSession` again, so the caller's `createdAt` resets to
  now. An attacker with a stolen session cookie and the account password can change the password, get a fresh session
  that looks step-up-fresh, and disable MFA without a second factor. The spec (`docs/legacy/...COMPLETE.md`, line 107)
  requires stronger authentication for MFA changes.
- **Fix:** Record the second-factor time explicitly on verification, not as the session's creation time. Or carry the
  pre-change `createdAt` onto the rotated session. Add a failing test first: disable MFA after a password change that
  used an old second factor, expecting `STEP_UP_REQUIRED`.
- **Tracking:** OZE-3233. The fix touches the password and step-up paths in `config.ts` and needs a Postgres
  integration test, so it is not a single-file change and is not made in this package.

### SEC-W2-002 (Medium): per-identity sign-in limit is check-then-act

- **Location:** `apps/server/src/auth/rate-limit.ts:102` (`refuseIfSpent`), with `recordFailedSignIn` at line 110.
- **Impact:** Sign-in reads the identity count, then runs the password check, then records a failure. Concurrent
  requests for one email all read a count below the limit before any failure is recorded, so a burst can exceed the
  per-identity limit. The per-IP limit still applies, so the exposure is a burst of roughly the concurrency level
  per identity, plus any distributed attacker who is not limited by IP.
- **Fix:** Reserve an attempt before the password check (increment, and decrement on success). That needs a Redis
  decrement path, so it touches `rate-limit.ts` and the adapter.
- **Status:** Deferred. Needs the counter contract changed. Tracked for the next Redis rate-limit change.

### SEC-W3-001 (Medium, latent): KYB submission does not check the caller's organization

- **Location:** `packages/app/src/publisher/submit-kyb.ts:15` (`submitKyb`) and
  `packages/adapter-postgres/src/publisher/publisher-kyb-store.ts:14` (`findPublisher`, `recordSubmission`).
- **Impact:** `submitKyb` takes a publisher ID and does not take an organization. The store reads and updates by ID
  only. The comment says "the caller resolves which publisher the session owns", but nothing enforces it. Once a route
  passes a URL ID straight through, a tenant could submit KYB for another tenant's draft publisher. No route serves
  this today (the route table in `apps/server/src/http/guards/routes.ts` has only session and auth routes), so there is
  no live exposure.
- **Fix:** Add `organizationId` to the input, filter `findPublisher` and the conditional update by it, and return
  `RESOURCE_NOT_FOUND` on mismatch, the same as `decideReview` does. Required before the publisher onboarding route
  ships.
- **Status:** Deferred until the route is added. The fix is multi-file (app, port, adapter) and needs the route-level
  test in the same change.

### SEC-W3-002 (Medium, latent): reinstate and suspend carry no permission of their own

- **Location:** `packages/app/src/properties/suspend.ts:72` (`reinstateProperty`), `:34` (`suspendProperty`),
  `packages/app/src/publisher/decide-review.ts:33` (`decideReview`).
- **Impact:** These use cases check only that an actor ID exists. They rely entirely on the guard in front of them.
  Reinstatement is a privileged action (spec, line 107). If a route maps reinstate to `properties:write`, the tenant
  owner or editor could restore a property that operations suspended, and so undo a safety stop. No route serves these
  today.
- **Fix:** Give reinstate its own permission, separate from `properties:write`, that no tenant role holds. Map it in
  the route table with a test that a tenant owner gets `FORBIDDEN`. Do this before the ops routes ship.
- **Status:** Deferred until the ops routes are added, tracked with the publisher review route work.

### SEC-W2-003 (Low): `trustProxy` defaults to true

- **Location:** `apps/server/src/http/auth.ts:37` and `apps/server/src/http/routes.ts:12`.
- **Impact:** With the default, the client's `x-forwarded-for` is passed to Better Auth, so a caller can pick its own
  per-IP rate-limit bucket. The composition root sets the value from `AUTH_TRUSTED_PROXIES`
  (`apps/server/src/index.ts:63`), so the live server is not exposed.
- **Fix:** Change both defaults to `false`, with a test that a client-sent `x-forwarded-for` does not reach Better Auth.
- **Status:** Deferred. The default is latent and both files need the change together.

### SEC-W3-003 (Low): verification attempts are counted but never capped

- **Location:** `packages/app/src/properties/verify.ts:145`.
- **Impact:** Each verify call performs a DNS lookup and increments `attempts`, but nothing reads `attempts` to refuse
  further calls. A user with `properties:write` can make unbounded TXT lookups against one challenge. The token has
  enough entropy that guessing is not practical, so the risk is resolver load and cost, not a bypass.
- **Fix:** Cap attempts per challenge and return `TOKEN_EXPIRED` or a rate code past the cap.
- **Status:** Deferred. The cap value is a product decision.

### SEC-W3-004 (Low): no Postgres adapter for property review yet

- **Location:** `packages/app/src/ports/property-review-store.ts`. No implementation exists under `adapter-postgres`.
- **Impact:** Only the in-memory fake implements `recordTransition`. The fake checks the organization and status, but
  the production adapter does not exist yet, so the tenant check in the conditional update is unverified.
- **Fix:** When the adapter lands, put the `organization_id` and `status` predicates in the same `update ... where`
  as the status change, and add an adapter test that a write from another tenant changes no row.
- **Status:** Deferred to the adapter task.

### SEC-W2-004 (Low, accepted): admin role holds every permission that owner holds

- **Location:** `packages/domain/src/access/permissions.ts:62`.
- **Impact:** Admins can move payouts (`payouts:write`), remove members, and change the organization. This is
  separation-of-duties exposure, not a bypass of tenant boundaries.
- **Reason for acceptance:** The catalog has no scope that separates owner from admin, and the code comment already
  records this. A catalog change comes first. Revisit when owner-only operations get their own permission.

### SEC-W2-005 (Low, accepted): analyst holds `reports:write`

- **Location:** `packages/domain/src/access/permissions.ts:68`.
- **Impact:** An analyst can create or change saved reports. No money or identity data is changed.
- **Reason for acceptance:** Saved reports are a deliberate analyst capability in the role design. Read-only analysts
  would need a separate permission name, which the catalog does not have.

### SEC-W2-006 (Low, accepted): removal by email is refused

- **Location:** `apps/server/src/auth/config.ts:232` (`refuseForeignMember`).
- **Impact:** `remove-member` with `memberIdOrEmail` set to an email is refused, so a member can only be removed by ID.
  This fails closed and does not reveal anything. It is a usability gap, not an authorization defect.
- **Reason for acceptance:** The refusal is intentional, because an email cannot be checked against the membership's
  organization. Removal by ID is still available.

## Checked and not a finding

- Session listing and revocation are scoped to the caller's own sessions. Foreign and unknown IDs get the same answer
  (`apps/server/src/http/sessions.ts:31`).
- The permission guard checks membership in the target organization before the role. A missing and a foreign resource
  get the same answer (`apps/server/src/http/guards/policy.ts:35`).
- `publisher:review` is in no tenant role (`permissions.ts:43`).
- Property and publisher decisions take the organization from the authorized scope, not the body, and filter by it
  (`decide-review.ts:45`, `suspend.ts:43`).
- Audit rows, KYB events, and the property history carry no document bytes (`publisher-kyb-store.ts:37`).
- Static assets are served from an exact-key map, so there is no path traversal (`apps/server/src/assets.ts`).
- Password reset tokens are retired when the password changes (`config.ts`, `settleVerificationLink`).
