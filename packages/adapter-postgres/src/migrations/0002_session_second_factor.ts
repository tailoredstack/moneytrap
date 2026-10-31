import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Records when the session's second factor was verified, so MFA changes can require a recent one (WP-2.6, API-004).
// Kept apart from 0002_better_auth, which is generated and not edited by hand.
export const sessionSecondFactor: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table "session" add column "secondFactorAt" timestamptz`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`alter table "session" drop column "secondFactorAt"`.execute(db);
  },
};
