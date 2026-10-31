import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Better Auth 1.7.14 schema (WP-2.2). Generated with `getMigrations(authOptions(...)).compileMigrations()`
// from `better-auth/db/migration` against an empty database, then committed as text. Do not edit by
// hand. Regenerate with the same version pinned in apps/server/package.json and review the diff.
// Domain identity tables live in 0003_identity (WP-2.12) and reference "user" from here.
const statements = [
  `create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);`,
  `create table "session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade, "activeOrganizationId" text);`,
  `create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);`,
  `create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);`,
  `create table "twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);`,
  `create table "organization" ("id" text not null primary key, "name" text not null, "slug" text not null unique, "logo" text, "createdAt" timestamptz not null, "metadata" text);`,
  `create table "member" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "userId" text not null references "user" ("id") on delete cascade, "role" text not null, "createdAt" timestamptz not null);`,
  `create table "invitation" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "email" text not null, "role" text, "status" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "inviterId" text not null references "user" ("id") on delete cascade);`,
  `create table "apikey" ("id" text not null primary key, "configId" text not null, "name" text, "start" text, "referenceId" text not null, "prefix" text, "key" text not null, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" timestamptz, "enabled" boolean, "rateLimitEnabled" boolean, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" timestamptz, "expiresAt" timestamptz, "createdAt" timestamptz not null, "updatedAt" timestamptz not null, "permissions" text, "metadata" text);`,
  `create index "session_userId_idx" on "session" ("userId");`,
  `create index "account_userId_idx" on "account" ("userId");`,
  `create index "verification_identifier_idx" on "verification" ("identifier");`,
  `create index "twoFactor_secret_idx" on "twoFactor" ("secret");`,
  `create index "twoFactor_userId_idx" on "twoFactor" ("userId");`,
  `create index "member_organizationId_idx" on "member" ("organizationId");`,
  `create index "member_userId_idx" on "member" ("userId");`,
  `create index "invitation_organizationId_idx" on "invitation" ("organizationId");`,
  `create index "invitation_email_idx" on "invitation" ("email");`,
  `create index "apikey_configId_idx" on "apikey" ("configId");`,
  `create index "apikey_referenceId_idx" on "apikey" ("referenceId");`,
  `create index "apikey_key_idx" on "apikey" ("key");`,
];

export const betterAuth: Migration = {
  async up(db: Kysely<unknown>) {
    for (const statement of statements) {
      await sql.raw(statement).execute(db);
    }
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists "apikey" cascade`.execute(db);
    await sql`drop table if exists "invitation" cascade`.execute(db);
    await sql`drop table if exists "member" cascade`.execute(db);
    await sql`drop table if exists "organization" cascade`.execute(db);
    await sql`drop table if exists "twoFactor" cascade`.execute(db);
    await sql`drop table if exists "verification" cascade`.execute(db);
    await sql`drop table if exists "account" cascade`.execute(db);
    await sql`drop table if exists "session" cascade`.execute(db);
    await sql`drop table if exists "user" cascade`.execute(db);
  },
};
