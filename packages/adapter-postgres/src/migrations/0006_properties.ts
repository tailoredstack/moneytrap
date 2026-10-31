import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Website properties and their DNS verification challenges (DM-011, DM-012, WP-3.5). A property belongs to an
// organization, which is the tenant key every read filters by. The publishers table lands with WP-3.1/3.2, so
// publisher_id is stored without a foreign key until then.
export const properties: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("properties")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("publisher_id", "text", (column) => column.notNull())
      .addColumn("type", "text", (column) => column.notNull().check(sql`type in ('website')`))
      .addColumn("canonical_identifier", "text", (column) => column.notNull())
      .addColumn("normalized_identifier", "text", (column) => column.notNull())
      .addColumn("status", "text", (column) =>
        column
          .notNull()
          .check(
            sql`status in ('draft', 'verification_pending', 'verified', 'review_pending', 'approved', 'rejected', 'suspended')`,
          ),
      )
      .addColumn("rejection_reason", "text")
      // Compare-and-set counter: every write checks the version it read at, so a racing write fails cleanly.
      .addColumn("version", "integer", (column) => column.notNull().defaultTo(1))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("properties_publisher_type_identifier_uq", ["publisher_id", "type", "normalized_identifier"])
      .execute();

    await db.schema
      .createTable("property_verifications")
      .addColumn("id", "text", (column) => column.primaryKey())
      // Issuance order, assigned by the database. The latest challenge is the highest value, regardless of clock or ID order.
      .addColumn("issue_seq", "bigint", (column) => column.generatedAlwaysAsIdentity().notNull())
      .addColumn("property_id", "text", (column) => column.notNull().references("properties.id").onDelete("cascade"))
      .addColumn("method", "text", (column) => column.notNull().check(sql`method in ('dns')`))
      .addColumn("challenge_hash", "text", (column) => column.notNull())
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("verified_at", "timestamptz")
      .addColumn("attempts", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();
    await db.schema
      .createIndex("property_verifications_property_idx")
      .on("property_verifications")
      .column("property_id")
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("property_verifications").ifExists().execute();
    await db.schema.dropTable("properties").ifExists().execute();
  },
};
