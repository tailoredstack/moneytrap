import { createHash } from "node:crypto";
import { apiKey } from "@better-auth/api-key";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from "better-auth/api";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";
import { requireRecentSecondFactor } from "../http/guards/assurance";
import { accessControl, roles } from "./access";
import type { AuthMailer } from "./mailer";
import {
  AUTH_RATE_LIMIT_POLICY,
  ipRateLimitRules,
  ipRateLimitStorage,
  type RateLimitCounter,
  type RateLimitPolicy,
  type RateLimitSettings,
  recordFailedSignIn,
  refuseIfSpent,
} from "./rate-limit";

// Blueprint §7: Better Auth keeps its defaults for hashing, tokens, and expiry. These are the only
// settings we change, and each one tightens a default rather than loosening it.
export const MIN_PASSWORD_LENGTH = 12;

// Blueprint §7: privileged routes need a second factor this recently. Operators set STEP_UP_WINDOW_SECONDS;
// 900 seconds (15 minutes) is the default when it is unset.
export const DEFAULT_STEP_UP_WINDOW_SECONDS = 900;

export function stepUpWindowSeconds(raw: string | undefined): number {
  if (!raw) return DEFAULT_STEP_UP_WINDOW_SECONDS;
  const seconds = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(seconds)) {
    throw new Error("STEP_UP_WINDOW_SECONDS must be a positive whole number of seconds");
  }
  return seconds;
}

export type AuthConfigDeps = {
  pool: Pool;
  secret: string;
  baseURL: string;
  mailer: AuthMailer;
  stepUpWindowSeconds?: number;
  // Redis-backed counter for login and recovery limits (WP-2.14). Both per-IP and per-identity limits use it.
  rateLimitCounter: RateLimitCounter;
  // Policy values for the limits. Defaults to AUTH_RATE_LIMIT_POLICY; the server reads overrides from the environment.
  rateLimitPolicy?: RateLimitPolicy;
  // Proxies in front of the server, as CIDRs. Better Auth reads the client IP from the address past the last trusted
  // hop. Empty means no proxy is trusted, so the IP comes from the socket peer (see authRoutes).
  trustedProxies?: string[];
};

// Better Auth verifies email tokens statelessly and never records their use, so a second click on the same
// link would succeed. Two hooks on /verify-email track each token in the verification table:
// - before: refuses a callbackURL we do not trust (Better Auth skips its origin check on GET), refuses a token
//   that is not canonical base64url JWT form, and claims the token as "pending". An existing claim rejects it.
// - after: a failed request deletes its pending claim, so the link stays usable. A successful one marks the
//   claim "used". Claims outlive the one-hour token, so Better Auth's expiry cleanup cannot release a token.
// A pending claim never expires within a day, so a second request cannot take it over. If a request crashes
// before the after-hook runs, the link stays blocked and the user needs a new verification email.
const CLAIM_RETENTION_MS = 24 * 60 * 60 * 1000;

// Only the exact canonical base64url spelling counts. Any other spelling is refused before a claim is made,
// so no alternate spelling of a claimed token can verify again.
function canonicalClaimId(token: string): string | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;
  for (const segment of segments) {
    if (!/^[A-Za-z0-9_-]+$/.test(segment)) return null;
    if (Buffer.from(segment, "base64url").toString("base64url") !== segment) return null;
  }
  return `verify-email-used:${createHash("sha256").update(token).digest("hex")}`;
}

// Reset links are one token each, and Better Auth consumes only the token that is redeemed. The before-hook looks up
// which user the token belongs to and hands that owner to this request's endpoint context. The after-hook then
// retires that user's other reset links once the reset succeeds (TP-W2-026). Keeping the owner on the request, not in
// shared state, means a concurrent request cannot clear it.
const RESET_OWNER = "resetOwnerId";

type AuthContext = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function claimVerificationLink(ctx: AuthContext, db: Kysely<any>) {
  {
    if (ctx.path === "/reset-password") {
      // Better Auth reads the body token first and falls back to the query string, so both must be checked.
      const token = ctx.body?.token || ctx.query?.token;
      if (typeof token !== "string") return;
      const row = await sql<{ value: string }>`
        select "value" from "verification"
        where "identifier" = ${`reset-password:${token}`} and "expiresAt" > now()`.execute(db);
      const owner = row.rows[0]?.value;
      if (owner) return { context: { [RESET_OWNER]: owner } };
      return;
    }
    if (ctx.path !== "/verify-email") return;

    const callbackURL = ctx.query?.callbackURL;
    if (callbackURL && !ctx.context.isTrustedOrigin(callbackURL, { allowRelativePaths: true })) {
      throw new APIError("FORBIDDEN", { code: "INVALID_CALLBACK_URL", message: "Invalid callbackURL" });
    }

    const token = ctx.query?.token;
    if (typeof token !== "string") return;
    const identifier = canonicalClaimId(token);
    if (!identifier) throw new APIError("BAD_REQUEST", { code: "INVALID_TOKEN", message: "Invalid token" });

    const claimed = await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const result = await sql`
        insert into "verification" ("id", "identifier", "value", "expiresAt")
        select ${crypto.randomUUID()}, ${identifier}, 'pending', ${new Date(Date.now() + CLAIM_RETENTION_MS)}
        where not exists (select 1 from "verification" where "identifier" = ${identifier})
        returning "id"`.execute(trx);
      return result.rows.length === 1;
    });
    if (!claimed) {
      throw new APIError("BAD_REQUEST", { code: "VERIFICATION_LINK_ALREADY_USED", message: "Link already used" });
    }
  }
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function retireResetLinks(db: Kysely<any>, userId: string) {
  return sql`delete from "verification" where "identifier" like 'reset-password:%' and "value" = ${userId}`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function settleVerificationLink(ctx: AuthContext, db: Kysely<any>) {
  {
    // A password change made while signed in, or a successful reset, retires every other outstanding reset link
    // for that user (TP-W2-026). Better Auth keeps those links valid, so each would still set a password afterwards.
    if (ctx.path === "/change-password") {
      const userId = ctx.context.session?.user.id;
      if (userId && !isAPIError(ctx.context.returned)) await retireResetLinks(db, userId);
      return;
    }
    if (ctx.path === "/reset-password") {
      const owner = (ctx as unknown as Record<string, unknown>)[RESET_OWNER];
      if (typeof owner === "string" && !isAPIError(ctx.context.returned)) await retireResetLinks(db, owner);
      return;
    }
    if (ctx.path !== "/verify-email") return;
    const token = ctx.query?.token;
    const identifier = typeof token === "string" ? canonicalClaimId(token) : null;
    if (!identifier) return;

    const returned = ctx.context.returned;
    const failed = isAPIError(returned) && returned.statusCode >= 400;
    if (failed) {
      await sql`delete from "verification" where "identifier" = ${identifier} and "value" = 'pending'`.execute(db);
    } else {
      await sql`update "verification" set "value" = 'used' where "identifier" = ${identifier} and "value" = 'pending'`.execute(
        db,
      );
    }
  }
}

// Better Auth's organization routes name the organization by ID or by slug, in the query or the body. A caller who is
// not a member of every organization a request names gets the not-found answer, the same for a foreign and a missing
// organization, so no response reveals that a foreign one exists (CT-005, TP-W2-033, TP-W2-034). Better Auth alone
// would answer them differently (403 against 400). The check runs before the endpoint, so a successful leave or delete
// is not reported as a failure after its own membership change.
// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function refuseForeignOrganization(ctx: AuthContext, db: Kysely<any>): Promise<void> {
  if (!ctx.path?.startsWith("/organization/")) return;
  // Slug availability answers whether a slug is taken, which reveals a foreign organization. No client uses it, so
  // every caller gets the same not-found answer, whether the slug is taken or free.
  if (ctx.path === "/organization/check-slug") {
    throw new APIError("NOT_FOUND", { code: "RESOURCE_NOT_FOUND", message: "Resource not found" });
  }
  const userId = (await getSessionFromCtx(ctx))?.user.id;
  if (!userId) return;
  // Every named organization is checked, so a request that names two cannot pass on the one the caller belongs to.
  for (const organizationId of await namedOrganizationIds(ctx, db)) {
    const member =
      await sql`select 1 from "member" where "organizationId" = ${organizationId} and "userId" = ${userId}`.execute(db);
    if (member.rows.length === 0) {
      throw new APIError("NOT_FOUND", { code: "RESOURCE_NOT_FOUND", message: "Resource not found" });
    }
  }
}

// Invitation routes name an invitation by ID. Only the invitee (by email) and members of its organization may act on
// it. Anyone else gets the not-found answer, the same as for a missing invitation, so an ID reveals nothing (CT-005).
const INVITATION_ROUTES = new Set([
  "/organization/accept-invitation",
  "/organization/reject-invitation",
  "/organization/cancel-invitation",
  "/organization/get-invitation",
]);
// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function refuseForeignInvitation(ctx: AuthContext, db: Kysely<any>): Promise<void> {
  if (!INVITATION_ROUTES.has(ctx.path ?? "")) return;
  const session = await getSessionFromCtx(ctx);
  const refuse = () => new APIError("NOT_FOUND", { code: "RESOURCE_NOT_FOUND", message: "Resource not found" });
  if (!session) throw refuse();
  // Each route reads its invitation from a different field (`id` or `invitationId`), and a request may name both.
  // Every named ID is checked, so the one the endpoint acts on is always one the caller may act on.
  const named = [...namedValues(ctx, "invitationId"), ...namedValues(ctx, "id")];
  if (named.length === 0) throw refuse();
  for (const invitationId of new Set(named)) {
    const row = (
      await sql<{ organizationId: string; email: string }>`
        select "organizationId", "email" from "invitation" where "id" = ${invitationId}`.execute(db)
    ).rows[0];
    if (!row) throw refuse();
    if (row.email === session.user.email) continue;
    const member =
      await sql`select 1 from "member" where "organizationId" = ${row.organizationId} and "userId" = ${session.user.id}`.execute(
        db,
      );
    if (member.rows.length === 0) throw refuse();
  }
}

// Every value a request names under `key`, whether in its query or its body. Better Auth reads a route's field from
// one of the two, so both are checked: a value in one place cannot hide a different value in the other.
function namedValues(ctx: AuthContext, key: string): string[] {
  const fromQuery = (ctx.query as Record<string, unknown> | undefined)?.[key];
  const fromBody = isRecord(ctx.body) ? ctx.body[key] : undefined;
  return [fromQuery, fromBody].filter((value): value is string => typeof value === "string");
}

// Member routes name a membership by its ID. The membership's organization decides who may act on it, so a caller who
// is not a member of that organization gets the not-found answer, the same as for a missing membership (CT-005).
const MEMBER_ROUTES = new Set(["/organization/remove-member", "/organization/update-member-role"]);
// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function refuseForeignMember(ctx: AuthContext, db: Kysely<any>): Promise<void> {
  if (!MEMBER_ROUTES.has(ctx.path ?? "")) return;
  const refuse = () => new APIError("NOT_FOUND", { code: "RESOURCE_NOT_FOUND", message: "Resource not found" });
  // remove-member reads its member from memberIdOrEmail, and update-member-role from memberId. A request that names
  // the membership by ID in either field is checked. An email is not an ID, so it matches no membership and is refused.
  const named = [...namedValues(ctx, "memberId"), ...namedValues(ctx, "memberIdOrEmail")];
  if (named.length === 0 || new Set(named).size > 1) throw refuse();
  const memberId = named[0] ?? "";
  const session = await getSessionFromCtx(ctx);
  if (!session) throw refuse();
  const row = (
    await sql<{ organizationId: string }>`select "organizationId" from "member" where "id" = ${memberId}`.execute(db)
  ).rows[0];
  if (!row) throw refuse();
  const member =
    await sql`select 1 from "member" where "organizationId" = ${row.organizationId} and "userId" = ${session.user.id}`.execute(
      db,
    );
  if (member.rows.length === 0) throw refuse();
}

// Slugs are chosen by the server, so a create never reveals whether a slug is taken (CT-005). The client's slug is
// replaced with the name's slug plus a random suffix, which keeps creates from colliding. Updates cannot change the
// slug, and a request that tries is refused with the generic validation failure.
function organizationBodyFor(ctx: AuthContext): { context: { body: Record<string, unknown> } } | undefined {
  if (ctx.path === "/organization/create") {
    const body = isRecord(ctx.body) ? ctx.body : {};
    const base = String(body.name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const slug = `${base || "org"}-${crypto.randomUUID().slice(0, 8)}`;
    return { context: { body: { ...body, slug } } };
  }
  if (ctx.path === "/organization/update") {
    const data = isRecord(ctx.body) && isRecord(ctx.body.data) ? ctx.body.data : {};
    if ("slug" in data) throw new APIError("BAD_REQUEST", { code: "VALIDATION_FAILED", message: "Request failed" });
  }
  return undefined;
}

// The organizations a request names, by ID and by slug. Empty when it names none. A slug that matches nothing
// resolves to an empty ID, which no membership matches, so it is refused like any other foreign organization.
// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function namedOrganizationIds(ctx: AuthContext, db: Kysely<any>): Promise<string[]> {
  const ids = namedValues(ctx, "organizationId");
  for (const slug of namedValues(ctx, "organizationSlug")) {
    const row = await sql<{
      id: string;
    }>`select "id" from "organization" where "slug" = ${slug}`.execute(db);
    ids.push(row.rows[0]?.id ?? "");
  }
  return ids;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A failed sign-in is any 4xx/5xx except 429. A 429 is a refusal, not a password guess, so it is not recorded.
function isFailedSignIn(returned: unknown): boolean {
  return isAPIError(returned) && returned.statusCode >= 400 && returned.statusCode !== 429;
}

// Every route that turns MFA off. They all share one step-up rule, so a route added here gets the same check.
const MFA_DISABLE_PATHS = new Set(["/two-factor/disable"]);

// Better Auth's changePassword with revokeOtherSessions deletes every session and creates a new one whose createdAt
// is now. The step-up check reads createdAt as the second-factor time, so the rotated session would look fresh with
// no second factor at all (SEC-W2-001). The before-hook keeps the caller's createdAt on the request, and the after-hook
// gives it to the rotated session, so a password change never moves the second-factor time forward.
const SECOND_FACTOR_AT = "secondFactorAt";

// The before-hook hands the time to this request's context, as the reset-owner lookup does.
async function rememberSecondFactorTime(ctx: AuthContext) {
  if (ctx.path !== "/change-password") return;
  const session = await getSessionFromCtx(ctx);
  if (session) return { context: { [SECOND_FACTOR_AT]: session.session.createdAt } };
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function carrySecondFactorTime(ctx: AuthContext, db: Kysely<any>) {
  if (ctx.path !== "/change-password") return;
  const secondFactorAt = (ctx as unknown as Record<string, unknown>)[SECOND_FACTOR_AT];
  const returned = ctx.context.returned;
  // A password change without revokeOtherSessions returns no token, and its session is still the original one.
  const token = isRecord(returned) ? returned.token : null;
  if (!(secondFactorAt instanceof Date) || typeof token !== "string") return;
  await sql`update "session" set "createdAt" = ${secondFactorAt} where "token" = ${token}`.execute(db);
}

// Better Auth's disable route only requires a session, not a fresh one, so the step-up check runs before it.
// The session's creation time stands in for the second-factor time: an MFA user's session is only created
// after the second factor passes, and a password change carries that time over (see above). Fails closed: a missing
// session, or any API-key request, is refused. The API-key plugin builds its session with the request time as
// createdAt, so an API key must not count as a second factor.
const API_KEY_HEADER = "x-api-key";
function requireStepUpToDisableMfa(stepUpWindow: number) {
  return createAuthMiddleware(async (ctx) => {
    const refuse = () => new APIError("FORBIDDEN", { code: "STEP_UP_REQUIRED", message: "Step-up required" });
    if (ctx.headers?.has(API_KEY_HEADER)) throw refuse();
    const session = await getSessionFromCtx(ctx);
    if (!session?.session) throw refuse();
    const result = requireRecentSecondFactor({
      secondFactorAt: new Date(session.session.createdAt),
      now: new Date(),
      windowSeconds: stepUpWindow,
    });
    if (!result.ok) throw refuse();
  });
}

export function authOptions({
  pool,
  secret,
  baseURL,
  mailer,
  stepUpWindowSeconds: stepUpWindow = DEFAULT_STEP_UP_WINDOW_SECONDS,
  rateLimitCounter,
  rateLimitPolicy: policy = AUTH_RATE_LIMIT_POLICY,
  trustedProxies = [],
}: AuthConfigDeps): BetterAuthOptions {
  const limits: RateLimitSettings = { secret, policy };
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
  return {
    database: {
      db,
      type: "postgres",
    },
    // Per-IP limits come from Better Auth through the Redis counter. The per-identity check runs before the password
    // check, and failed sign-ins are recorded after it, so a correct password is never throttled.
    rateLimit: {
      enabled: true,
      customStorage: ipRateLimitStorage(rateLimitCounter),
      customRules: ipRateLimitRules(policy),
    },
    // Which hops are proxies decides the client IP that per-IP limits count (spec §4.4). Set it from deployment config.
    advanced: { ipAddress: { trustedProxies } },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await refuseIfSpent(rateLimitCounter, ctx.path, ctx.body ?? {}, limits);
        await refuseForeignOrganization(ctx, db);
        await refuseForeignInvitation(ctx, db);
        await refuseForeignMember(ctx, db);
        const organizationBody = organizationBodyFor(ctx);
        if (organizationBody) return organizationBody;
        const secondFactor = await rememberSecondFactorTime(ctx);
        if (secondFactor) return secondFactor;
        return claimVerificationLink(ctx, db);
      }),
      after: createAuthMiddleware(async (ctx) => {
        // The hook replaces the endpoint result; returning a value from an after hook does not reach the response.
        if (ctx.path === "/sign-in/email" && isFailedSignIn(ctx.context.returned)) {
          await recordFailedSignIn(rateLimitCounter, ctx.body ?? {}, limits);
        }
        await carrySecondFactorTime(ctx, db);
        await settleVerificationLink(ctx, db);
      }),
    },
    secret,
    baseURL,
    // Sensitive routes, including disabling MFA, need a session created within the step-up window (TP-W2-019).
    session: {
      freshAge: stepUpWindow,
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendPasswordReset(user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.sendVerification(user.email, url);
      },
    },
    plugins: [
      haveIBeenPwned(),
      twoFactor({ issuer: "Moneytrap" }),
      // Invitations keep Better Auth's defaults: a 48-hour expiry, and acceptance is refused once the invitation is no
      // longer pending, so a second accept fails and creates no second membership.
      organization({
        ac: accessControl,
        roles,
        sendInvitationEmail: async ({ id, email, invitation }) => {
          await mailer.sendInvitation(email, `${baseURL}/invitations/${id}`, new Date(invitation.expiresAt));
        },
      }),
      apiKey({ enableSessionForAPIKeys: true }),
      {
        id: "moneytrap-step-up",
        hooks: {
          before: [
            {
              matcher: (ctx) => MFA_DISABLE_PATHS.has((ctx.path ?? "").replace(/\/+$/, "")),
              handler: requireStepUpToDisableMfa(stepUpWindow),
            },
          ],
        },
      },
    ],
  };
}

export function createAuth(deps: AuthConfigDeps) {
  const auth = betterAuth(authOptions(deps));
  // Better Auth turns errors from hooks into responses, but not errors thrown by its rate-limit storage. Convert those
  // here, so a Redis outage reaches the client as the coded 503 and not as an unhandled exception.
  const handler = auth.handler;
  auth.handler = async (request: Request) => {
    try {
      return await handler(request);
    } catch (error) {
      if (!isAPIError(error)) throw error;
      return Response.json(error.body ?? { message: error.message }, {
        status: error.statusCode,
        headers: error.headers,
      });
    }
  };
  return auth;
}
