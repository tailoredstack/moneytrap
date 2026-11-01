// Local development seed: one organization with one owner who can sign in and open the dashboard.
//
// FOR LOCAL USE ONLY. The owner below uses a password that is committed to this repo. Never seed a shared or deployed
// database with it.
//   email:    owner@moneytrap.test
//   password: dev-only-moneytrap-password
//
// Run `bun run seed` from the repo root after `bun run db:migrate`. Re-running it is safe: every row has a fixed ID and
// is written with `on conflict do nothing`, so a second run inserts nothing and changes nothing. An existing row is
// left as it is, so the password is not reset on a later run.
//
// The rows cover what the code reads for this owner:
//   - "user" and "account" (credential): Better Auth sign-in. Email verification is required, so the user is verified.
//   - "organization" and "member": Better Auth's organization plugin, which the session and the organization guards read.
//   - "organizations" and "memberships": Moneytrap's own organization and role tables, which the guards read.

import { type Id, parseId } from "@moneytrap/domain";
import { hashPassword } from "better-auth/crypto";
import { Kysely, PostgresDialect, type QueryResult, sql } from "kysely";
import { Pool } from "pg";

export const DEV_OWNER_EMAIL = "owner@moneytrap.test";
export const DEV_OWNER_PASSWORD = "dev-only-moneytrap-password";

// Fixed IDs, so a re-run finds the same rows. Each body is 26 characters from the ID alphabet.
const USER_ID = devId("user", `${"0".repeat(22)}dev1`);
const ORG_ID = devId("organization", `${"0".repeat(22)}dev1`);
const ORG_SLUG = "dev-org";
const CREDENTIAL_ACCOUNT_ID = "dev-owner-credential";
const MEMBER_ID = "dev-owner-member";

function devId<K extends "user" | "organization">(kind: K, body: string): Id<K> {
  const id = parseId(kind, `${kind === "user" ? "usr" : "org"}_${body}`);
  if (!id) throw new Error(`invalid dev ${kind} id`);
  return id;
}

// Writes the seed rows in one transaction and reports, per row, whether it was inserted or already present.
export async function seedDevData(db: Kysely<unknown>): Promise<string[]> {
  const passwordHash = await hashPassword(DEV_OWNER_PASSWORD);
  const now = new Date();
  const writes: Array<[string, QueryResult<unknown>]> = [];

  await db.transaction().execute(async (tx) => {
    writes.push([
      `user ${USER_ID}`,
      await sql`insert into "user" ("id", "name", "email", "emailVerified", "createdAt", "updatedAt")
        values (${USER_ID}, ${"Dev Owner"}, ${DEV_OWNER_EMAIL}, true, ${now}, ${now})
        on conflict do nothing`.execute(tx),
    ]);
    writes.push([
      `account ${CREDENTIAL_ACCOUNT_ID}`,
      await sql`insert into "account" ("id", "accountId", "providerId", "userId", "password", "createdAt", "updatedAt")
        values (${CREDENTIAL_ACCOUNT_ID}, ${USER_ID}, 'credential', ${USER_ID}, ${passwordHash}, ${now}, ${now})
        on conflict do nothing`.execute(tx),
    ]);
    writes.push([
      `organization ${ORG_ID}`,
      await sql`insert into "organization" ("id", "name", "slug", "createdAt")
        values (${ORG_ID}, ${"Moneytrap Dev"}, ${ORG_SLUG}, ${now})
        on conflict do nothing`.execute(tx),
    ]);
    writes.push([
      `member ${MEMBER_ID}`,
      await sql`insert into "member" ("id", "organizationId", "userId", "role", "createdAt")
        values (${MEMBER_ID}, ${ORG_ID}, ${USER_ID}, 'owner', ${now})
        on conflict do nothing`.execute(tx),
    ]);
    writes.push([
      `organizations ${ORG_ID}`,
      await sql`insert into "organizations" ("id", "name", "country", "base_currency", "status", "created_by", "created_at", "updated_at")
        values (${ORG_ID}, ${"Moneytrap Dev"}, 'US', 'USD', 'active', ${USER_ID}, ${now}, ${now})
        on conflict do nothing`.execute(tx),
    ]);
    writes.push([
      `memberships ${ORG_ID} ${USER_ID}`,
      await sql`insert into "memberships" ("organization_id", "user_id", "role")
        values (${ORG_ID}, ${USER_ID}, 'owner')
        on conflict do nothing`.execute(tx),
    ]);
  });

  return writes.map(
    ([label, result]) => `${Number(result.numAffectedRows ?? 0) > 0 ? "inserted" : "skipped"} ${label}`,
  );
}

if (import.meta.main) {
  const connectionString = Bun.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for seed");

  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }) });
  try {
    for (const line of await seedDevData(db)) console.log(line);
    console.log(`owner: ${DEV_OWNER_EMAIL} (local use only)`);
  } finally {
    await db.destroy();
  }
}
