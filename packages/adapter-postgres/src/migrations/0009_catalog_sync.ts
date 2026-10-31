import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Catalog sync state (WP-4.6). One cursor row per network and scope keeps where a paged pass stopped and the freshness
// watermark of the last completed pass. Quarantined records are kept beside the source facts, never inside them, so a
// malformed payload cannot become a program.
export const catalogSync: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("catalog_sync_cursors")
      .addColumn("network_id", "text", (column) => column.notNull())
      .addColumn("scope", "text", (column) => column.notNull())
      .addColumn("cursor", "text")
      .addColumn("watermark", "timestamptz")
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("catalog_sync_cursors_pk", ["network_id", "scope"])
      .execute();

    await db.schema
      .createTable("catalog_quarantine")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_id", "text", (column) => column.notNull())
      .addColumn("scope", "text", (column) => column.notNull())
      .addColumn("source_id", "text")
      .addColumn("reason", "text", (column) => column.notNull())
      .addColumn("payload", "text", (column) => column.notNull())
      .addColumn("observed_at", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("catalog_quarantine").ifExists().execute();
    await db.schema.dropTable("catalog_sync_cursors").ifExists().execute();
  },
};
