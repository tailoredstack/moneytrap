import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Settlement receipts (DM-041, WP-7.1). A receipt is identified by its network and its network reference, so importing the
// same reference again finds the stored row instead of adding one. A row is never updated or deleted. gross_minor is bigint
// minor units, so no amount is a floating-point value.
export const settlementReceipts: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("settlement_receipts")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_id", "text", (column) => column.notNull().references("networks.id"))
      .addColumn("external_ref", "text", (column) => column.notNull().check(sql`length(external_ref) > 0`))
      .addColumn("gross_minor", "bigint", (column) => column.notNull().check(sql`gross_minor >= 0`))
      .addColumn("currency", "text", (column) => column.notNull().check(sql`currency ~ '^[A-Z]{3}$'`))
      .addColumn("received_at", "timestamptz", (column) => column.notNull())
      .addColumn("state", "text", (column) => column.notNull().check(sql`length(state) > 0`))
      .addColumn("object_ref", "text")
      .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint("settlement_receipts_source_uq", ["network_id", "external_ref"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("settlement_receipts").execute();
  },
};
