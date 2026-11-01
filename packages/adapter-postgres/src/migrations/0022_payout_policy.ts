import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Versioned payout policy and payout holds (DM-045, spec §4.5, WP-7.6). A policy row is never updated or deleted: a change
// publishes the next version, so a decision that named an earlier version can be read again under that version. A hold
// is released by setting released_at once; it is never deleted.
export const payoutPolicy: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("payout_policies")
      .addColumn("currency", "text", (column) => column.notNull())
      .addColumn("version", "integer", (column) => column.notNull().check(sql`version >= 1`))
      .addColumn("minimum_minor", "bigint", (column) => column.notNull().check(sql`minimum_minor >= 0`))
      .addColumn("effective_from", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("payout_policies_pk", ["currency", "version"])
      .execute();

    await db.schema
      .createTable("payout_holds")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("publisher_id", "text", (column) => column.notNull().references("publishers.id").onDelete("cascade"))
      .addColumn("currency", "text", (column) => column.notNull())
      .addColumn("amount_minor", "bigint", (column) => column.notNull().check(sql`amount_minor > 0`))
      .addColumn("reason", "text", (column) => column.notNull().check(sql`length(trim(reason)) > 0`))
      .addColumn("expires_at", "timestamptz")
      .addColumn("released_at", "timestamptz")
      .addColumn("created_by", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();
    await db.schema
      .createIndex("payout_holds_publisher_idx")
      .on("payout_holds")
      .columns(["publisher_id", "currency"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("payout_holds").ifExists().execute();
    await db.schema.dropTable("payout_policies").ifExists().execute();
  },
};
