import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { organization, twoFactor } from "better-auth/plugins";
import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

export type AuthOptions = {
  pool: Pool;
  secret: string;
  baseURL: string;
};

export function createAuth({ pool, secret, baseURL }: AuthOptions) {
  return betterAuth({
    database: {
      // biome-ignore lint/suspicious/noExplicitAny: Better Auth takes its own schema types, not ours
      db: new Kysely<any>({ dialect: new PostgresDialect({ pool }) }),
      type: "postgres",
    },
    secret,
    baseURL,
    emailAndPassword: { enabled: true },
    plugins: [organization(), twoFactor({ issuer: "Moneytrap Compat" }), apiKey({ enableSessionForAPIKeys: true })],
  });
}
