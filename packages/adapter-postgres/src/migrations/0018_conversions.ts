import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Imported network batches and conversion source facts (DM-031, DM-032, WP-6.5). A batch is one file from one network,
// identified by (network, resource, sha256). Each row in a batch is recorded once, and each change to a source row
// becomes a new revision, numbered per source fact, so earlier revisions are never overwritten (spec §4.2, CT-018).
// Replaying a file with the same digest writes nothing, because the batch already exists (CT-012).
export const conversions: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("network_import_batches")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_id", "text", (column) => column.notNull().references("networks.id"))
      .addColumn("resource", "text", (column) => column.notNull())
      .addColumn("sha256_digest", "text", (column) => column.notNull())
      .addColumn("object_ref", "text", (column) => column.notNull())
      .addColumn("parser_version", "text", (column) => column.notNull())
      .addColumn("source_from", "timestamptz")
      .addColumn("source_to", "timestamptz")
      .addColumn("state", "text", (column) => column.notNull().check(sql`state in ('running','completed')`))
      .addColumn("started_at", "timestamptz", (column) => column.notNull())
      .addColumn("finished_at", "timestamptz")
      .addUniqueConstraint("network_import_batches_file_uq", ["network_id", "resource", "sha256_digest"])
      .execute();

    // One row per network transaction, keyed by the network's own reference. current_revision_seq is 0 only inside the
    // insert transaction, before the first revision exists.
    await db.schema
      .createTable("conversion_source_facts")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_id", "text", (column) => column.notNull().references("networks.id"))
      .addColumn("source_ref", "text", (column) => column.notNull())
      .addColumn("current_revision_seq", "integer", (column) => column.notNull().defaultTo(0))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("conversion_source_facts_network_ref_uq", ["network_id", "source_ref"])
      .execute();

    await db.schema
      .createTable("conversion_source_revisions")
      .addColumn("source_fact_id", "text", (column) =>
        column.notNull().references("conversion_source_facts.id").onDelete("cascade"),
      )
      .addColumn("revision_seq", "integer", (column) => column.notNull())
      .addColumn("source_revision", "text", (column) => column.notNull())
      .addColumn("payload", "jsonb", (column) => column.notNull())
      .addColumn("batch_id", "text", (column) => column.notNull().references("network_import_batches.id"))
      .addColumn("observed_at", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("conversion_source_revisions_pk", ["source_fact_id", "revision_seq"])
      .execute();

    // Every row of every batch, including quarantined ones. payload_digest is null only for a quarantined row, because a
    // malformed row has no normalized payload to hash. The conversion_id column arrives with the conversions table (WP-6.6).
    await db.schema
      .createTable("conversion_import_rows")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("batch_id", "text", (column) =>
        column.notNull().references("network_import_batches.id").onDelete("cascade"),
      )
      .addColumn("external_row_ref", "text", (column) => column.notNull())
      .addColumn("payload_digest", "text")
      .addColumn("outcome", "text", (column) =>
        column.notNull().check(sql`outcome in ('created','revised','unchanged','quarantined')`),
      )
      .addColumn("source_fact_id", "text", (column) => column.references("conversion_source_facts.id"))
      .addColumn("revision_seq", "integer")
      .addColumn("error_code", "text")
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("conversion_import_rows_batch_ref_uq", ["batch_id", "external_row_ref"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("conversion_import_rows").ifExists().execute();
    await db.schema.dropTable("conversion_source_revisions").ifExists().execute();
    await db.schema.dropTable("conversion_source_facts").ifExists().execute();
    await db.schema.dropTable("network_import_batches").ifExists().execute();
  },
};
