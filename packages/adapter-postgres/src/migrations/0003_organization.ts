import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Organizations and owner memberships (DM-006, WP-2.8). Both reference Better Auth's "user" table
// from 0002_better_auth. Better Auth's own "organization" and "member" tables stay separate.
export const organization: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("organizations")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("name", "text", (column) => column.notNull())
      .addColumn("country", "text", (column) => column.notNull())
      .addColumn("base_currency", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) => column.notNull().check(sql`status in ('active', 'suspended', 'closed')`))
      .addColumn("created_by", "text", (column) => column.notNull().references("user.id"))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("memberships")
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("user_id", "text", (column) => column.notNull().references("user.id").onDelete("cascade"))
      .addColumn("role", "text", (column) => column.notNull().check(sql`role in ('owner')`))
      .addPrimaryKeyConstraint("memberships_pk", ["organization_id", "user_id"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("memberships").ifExists().execute();
    await db.schema.dropTable("organizations").ifExists().execute();
  },
};
