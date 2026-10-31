import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Links (DM-040, WP-5.2). A link belongs to one organization, which is the tenant key every read filters by. Its property
// is a foreign key over (property_id, organization_id), so a link can only name a property of its own tenant, as the
// eligibility decisions and program approvals do. The program is a catalog row, so it is a plain foreign key.
export const links: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("links")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("publisher_id", "text", (column) => column.notNull())
      .addColumn("property_id", "text", (column) => column.notNull())
      .addColumn("program_id", "text", (column) => column.notNull().references("programs.id").onDelete("cascade"))
      .addColumn("slug", "text", (column) => column.notNull())
      .addColumn("destination_url", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) =>
        column.notNull().check(sql`status in ('draft', 'active', 'paused', 'revoked')`),
      )
      // Compare-and-set counter: every write checks the version it read at, so a racing write fails cleanly.
      .addColumn("version", "integer", (column) => column.notNull().defaultTo(1))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addForeignKeyConstraint(
        "links_property_org_fk",
        ["property_id", "organization_id"],
        "properties",
        ["id", "organization_id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists links`.execute(db);
  },
};
