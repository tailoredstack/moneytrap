import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Publishers and their KYB submissions (DM-009, DM-010, WP-3.2). publisher_kyb keeps a reference to the compliance
// vault's document in provider_ref and never the document itself, so no column can hold document bytes.
// Only the states the domain lifecycle names are allowed (spec §5, Publisher).
export const publisher: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("publishers")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("legal_name", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) =>
        column.notNull().check(sql`status in ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'suspended')`),
      )
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .execute();

    await db.schema
      .createTable("publisher_kyb")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("publisher_id", "text", (column) =>
        column.notNull().unique().references("publishers.id").onDelete("cascade"),
      )
      .addColumn("entity_type", "text", (column) => column.notNull())
      .addColumn("company_reference", "text")
      .addColumn("provider", "text")
      .addColumn("provider_ref", "text", (column) => column.notNull())
      .addColumn("state", "text", (column) =>
        column.notNull().check(sql`state in ('submitted', 'in_review', 'approved', 'rejected')`),
      )
      .addColumn("reviewed_by", "text", (column) => column.references("user.id"))
      .addColumn("reviewed_at", "timestamptz")
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("publisher_kyb").ifExists().execute();
    await db.schema.dropTable("publishers").ifExists().execute();
  },
};
