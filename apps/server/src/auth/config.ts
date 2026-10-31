import { createHash } from "node:crypto";
import { apiKey } from "@better-auth/api-key";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";
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
};

// Better Auth verifies email tokens statelessly and does not record their use, so a second click on the
// same link would succeed. This hook claims each token once in the verification table before Better Auth
// runs. The claim is serialized per token with an advisory lock so two concurrent clicks cannot both win.
const VERIFICATION_LINK_ONE_DAY_MS = 24 * 60 * 60 * 1000;

// biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
function consumeVerificationToken(db: Kysely<any>) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== "/verify-email") return;
    const token = ctx.query?.token;
    if (typeof token !== "string") return;

    const identifier = `verify-email-used:${createHash("sha256").update(token).digest("hex")}`;
    const claimed = await db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${identifier}))`.execute(trx);
      const result = await sql`
        insert into "verification" ("id", "identifier", "value", "expiresAt")
        select ${crypto.randomUUID()}, ${identifier}, 'used', ${new Date(Date.now() + VERIFICATION_LINK_ONE_DAY_MS)}
        where not exists (select 1 from "verification" where "identifier" = ${identifier})
        returning "id"`.execute(trx);
      return result.rows.length === 1;
    });
    if (!claimed) {
      throw new APIError("BAD_REQUEST", { code: "VERIFICATION_LINK_ALREADY_USED", message: "Link already used" });
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
      before: consumeVerificationToken(db),
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
