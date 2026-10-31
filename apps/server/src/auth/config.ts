import { apiKey } from "@better-auth/api-key";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { haveIBeenPwned, organization, twoFactor } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
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

export function authOptions({ pool, secret, baseURL, mailer }: AuthConfigDeps): BetterAuthOptions {
  return {
    database: {
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
      db: new Kysely<any>({ dialect: new PostgresDialect({ pool }) }),
      type: "postgres",
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
