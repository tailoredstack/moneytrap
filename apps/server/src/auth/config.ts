import { createHash } from "node:crypto";
import { apiKey } from "@better-auth/api-key";
import { type BetterAuthOptions, type BetterAuthPlugin, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { getSessionCookie } from "better-auth/cookies";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";
import { requireRecentSecondFactor } from "../http/guards/assurance";
import type { AuthMailer } from "./mailer";

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
  stepUpWindow?: number;
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

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function claimVerificationLink(db: Kysely<any>) {
  return createAuthMiddleware(async (ctx) => {
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
  });
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function retireResetLinks(db: Kysely<any>, userId: string) {
  return sql`delete from "verification" where "identifier" like 'reset-password:%' and "value" = ${userId}`.execute(db);
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function settleVerificationLink(db: Kysely<any>) {
  return createAuthMiddleware(async (ctx) => {
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
  });
}

// WP-2.6 step-up. Better Auth's disable route checks only the password, so disabling MFA also needs a second factor
// verified recently on this session (Blueprint §7, TP-W2-019). Better Auth issues a session on sign-in, so the
// sign-in second factor stamps the session it creates. Enrollment runs on an existing session and stamps nothing.
const SIGN_IN_SECOND_FACTOR_ROUTES = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"];

function sessionTokenOf(headers: Headers | undefined): string | null {
  const cookie = headers ? getSessionCookie(headers) : null;
  return cookie ? (cookie.split(".")[0] ?? null) : null;
}

async function issuedSessionToken(returned: unknown): Promise<string | null> {
  const body =
    returned instanceof Response
      ? await returned
          .clone()
          .json()
          .catch(() => null)
      : returned;
  const token = (body as { token?: unknown } | null)?.token;
  return typeof token === "string" ? token : null;
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function requireRecentSecondFactorToDisable(db: Kysely<any>, windowSeconds: number) {
  return createAuthMiddleware(async (ctx) => {
    const token = sessionTokenOf(ctx.headers);
    const row = token
      ? await sql<{ secondFactorAt: Date | null }>`
          select "secondFactorAt" from "session"
          where "token" = ${token} and "expiresAt" > ${new Date()}`.execute(db)
      : null;
    const result = requireRecentSecondFactor({
      secondFactorAt: row?.rows[0]?.secondFactorAt ?? null,
      now: new Date(),
      windowSeconds,
    });
    if (!result.ok) {
      throw new APIError("FORBIDDEN", { code: "STEP_UP_REQUIRED", message: "A recent second factor is required" });
    }
  });
}

// A cookie alone does not mean a signed-in caller: an expired or unknown cookie takes Better Auth's sign-in branch.
// So enrollment is recognised only by a live session row behind the cookie.
// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
async function hasLiveSession(db: Kysely<any>, headers: Headers | undefined): Promise<boolean> {
  const token = sessionTokenOf(headers);
  if (!token) return false;
  const row = await sql`select 1 from "session" where "token" = ${token} and "expiresAt" > ${new Date()}`.execute(db);
  return row.rows.length > 0;
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function stampSecondFactor(db: Kysely<any>) {
  return createAuthMiddleware(async (ctx) => {
    if (isAPIError(ctx.context.returned) || (await hasLiveSession(db, ctx.headers))) return;
    const token = await issuedSessionToken(ctx.context.returned);
    if (!token) return;
    await sql`update "session" set "secondFactorAt" = ${new Date()} where "token" = ${token}`.execute(db);
  });
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function mfaStepUpPlugin(db: Kysely<any>, windowSeconds: number): BetterAuthPlugin {
  return {
    id: "moneytrap-mfa-step-up",
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === "/two-factor/disable",
          handler: requireRecentSecondFactorToDisable(db, windowSeconds),
        },
      ],
      after: [
        {
          matcher: (ctx) => SIGN_IN_SECOND_FACTOR_ROUTES.includes(ctx.path ?? ""),
          handler: stampSecondFactor(db),
        },
      ],
    },
  };
}

export function authOptions(deps: AuthConfigDeps): BetterAuthOptions {
  return buildAuthOptions(deps);
}

// Not exported with a return annotation: the literal keeps the plugin list, so createAuth's auth.api has the twoFactor
// endpoints. `satisfies` checks the shape without widening it.
function buildAuthOptions({ pool, secret, baseURL, mailer, stepUpWindow }: AuthConfigDeps) {
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
  return {
    database: {
      db,
      type: "postgres",
    },
    hooks: {
      before: claimVerificationLink(db),
      after: settleVerificationLink(db),
    },
    secret,
    baseURL,
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
      mfaStepUpPlugin(db, stepUpWindow ?? DEFAULT_STEP_UP_WINDOW_SECONDS),
      organization(),
      apiKey({ enableSessionForAPIKeys: true }),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(deps: AuthConfigDeps) {
  return betterAuth(buildAuthOptions(deps));
}
