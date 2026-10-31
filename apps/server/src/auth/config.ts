import { createHash } from "node:crypto";
import { apiKey } from "@better-auth/api-key";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";
import type { AuthMailer } from "./mailer";

// Blueprint §7: Better Auth keeps its defaults for hashing, tokens, and expiry. These are the only
// settings we change, and each one tightens a default rather than loosening it.
export const MIN_PASSWORD_LENGTH = 12;

export type AuthConfigDeps = {
  pool: Pool;
  secret: string;
  baseURL: string;
  mailer: AuthMailer;
};

// Better Auth verifies email tokens statelessly and never records their use, so a second click on the same
// link would succeed. Two hooks on /verify-email track each token in the verification table:
// - before: claims the token as "pending" under an advisory lock. Any existing claim rejects the request.
// - after: a failed request deletes its pending claim, so the link stays usable. A successful one marks the
//   claim "used", which is permanent. A request that crashes before the after-hook runs leaves its pending
//   claim, which expires after PENDING_LEASE_MS.
const PENDING_LEASE_MS = 60 * 1000;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]*={0,2}$/;

// jose accepts equivalent base64url spellings of a JWT (for example a trailing "="), so the claim key comes
// from the decoded segments, not the raw string. Returns null when the value is not a three-part JWT.
function verificationClaimId(token: string): string | null {
  const segments = token.split(".");
  if (segments.length !== 3 || !segments.every((segment) => BASE64URL_SEGMENT.test(segment))) return null;
  const canonical = segments.map((segment) =>
    Buffer.from(segment.replace(/=+$/, ""), "base64url").toString("base64url"),
  );
  return `verify-email-used:${createHash("sha256").update(canonical.join(".")).digest("hex")}`;
}

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function claimVerificationLink(db: Kysely<any>) {
  return createAuthMiddleware(async (ctx) => {
    const token = ctx.query?.token;
    const identifier = ctx.path === "/verify-email" && typeof token === "string" ? verificationClaimId(token) : null;
    if (!identifier) return;

    const claimed = await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      await sql`delete from "verification" where "identifier" = ${identifier} and "value" = 'pending' and "expiresAt" < now()`.execute(
        trx,
      );
      const result = await sql`
        insert into "verification" ("id", "identifier", "value", "expiresAt")
        select ${crypto.randomUUID()}, ${identifier}, 'pending', ${new Date(Date.now() + PENDING_LEASE_MS)}
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
function settleVerificationLink(db: Kysely<any>) {
  return createAuthMiddleware(async (ctx) => {
    const token = ctx.query?.token;
    const identifier = ctx.path === "/verify-email" && typeof token === "string" ? verificationClaimId(token) : null;
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

export function authOptions({ pool, secret, baseURL, mailer }: AuthConfigDeps): BetterAuthOptions {
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
      organization(),
      apiKey({ enableSessionForAPIKeys: true }),
    ],
  };
}

export function createAuth(deps: AuthConfigDeps) {
  return betterAuth(authOptions(deps));
}
