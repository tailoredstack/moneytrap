import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Domain identity state (DM-001, WP-2.12). Better Auth owns credentials, sessions, verification
// tokens, and MFA (0002_better_auth). This table holds the domain-only fields Better Auth does not
// store: the account state machine, the auth version, and the locale. The user row is the anchor.
export const identity: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("user_profiles")
      .addColumn("user_id", "text", (column) => column.primaryKey().references("user.id").onDelete("cascade"))
      .addColumn("status", "text", (column) =>
        column.notNull().check(sql`status in ('pending', 'active', 'suspended', 'closed')`),
      )
      .addColumn("auth_version", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("locale", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("user_profiles").ifExists().execute();
  },
};
