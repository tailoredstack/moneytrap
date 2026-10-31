import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Advertiser and program source facts (DM-021, DM-022, WP-4.5). Each row is a network's own record, keyed by the
// network's source ID. Every reported change is a row in the matching revisions table, numbered per record, so earlier
// revisions are never overwritten (spec §4.2). The network_id column has no foreign key until the networks table lands
// with WP-4.4, the same way publisher_id is stored before its table exists.
export const catalog: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("network_advertisers")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_id", "text", (column) => column.notNull())
      .addColumn("external_id", "text", (column) => column.notNull())
      // Points at the latest revision. 0 means no revision exists yet, which is only true inside the insert transaction.
      .addColumn("current_revision_seq", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("network_advertisers_network_external_uq", ["network_id", "external_id"])
      .execute();

    await db.schema
      .createTable("network_advertiser_revisions")
      .addColumn("network_advertiser_id", "text", (column) =>
        column.notNull().references("network_advertisers.id").onDelete("cascade"),
      )
      .addColumn("revision_seq", "integer", (column) => column.notNull())
      .addColumn("source_revision", "text", (column) => column.notNull())
      .addColumn("payload", "jsonb", (column) => column.notNull())
      .addColumn("observed_at", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("network_advertiser_revisions_pk", ["network_advertiser_id", "revision_seq"])
      .execute();

    await db.schema
      .createTable("programs")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_advertiser_id", "text", (column) =>
        column.notNull().references("network_advertisers.id").onDelete("cascade"),
      )
      .addColumn("external_id", "text", (column) => column.notNull())
      .addColumn("current_revision_seq", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("programs_advertiser_external_uq", ["network_advertiser_id", "external_id"])
      .execute();

    await db.schema
      .createTable("program_revisions")
      .addColumn("program_id", "text", (column) => column.notNull().references("programs.id").onDelete("cascade"))
      .addColumn("revision_seq", "integer", (column) => column.notNull())
      .addColumn("source_revision", "text", (column) => column.notNull())
      .addColumn("payload", "jsonb", (column) => column.notNull())
      .addColumn("observed_at", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("program_revisions_pk", ["program_id", "revision_seq"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("program_revisions").ifExists().execute();
    await db.schema.dropTable("programs").ifExists().execute();
    await db.schema.dropTable("network_advertiser_revisions").ifExists().execute();
    await db.schema.dropTable("network_advertisers").ifExists().execute();
  },
};
