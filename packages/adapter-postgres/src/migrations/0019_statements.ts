import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Closed statements for a publisher and currency over one period (DM-050, WP-6.10). A row is never updated or deleted.
// content_hash is the sha256 of the canonical content, so a stored statement can be checked against its hash. The
// uniqueness rule includes revision, so a later revision could be added without rewriting an earlier one.
export const statements: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("statements")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("publisher_id", "text", (column) => column.notNull().references("publishers.id"))
      .addColumn("currency", "text", (column) => column.notNull())
      .addColumn("period_start", "timestamptz", (column) => column.notNull())
      .addColumn("period_end", "timestamptz", (column) => column.notNull())
      .addColumn("revision", "integer", (column) => column.notNull().check(sql`revision >= 1`))
      .addColumn("totals", "jsonb", (column) => column.notNull())
      .addColumn("content", "jsonb", (column) => column.notNull())
      .addColumn("content_hash", "text", (column) => column.notNull().check(sql`content_hash ~ '^[0-9a-f]{64}$'`))
      .addColumn("object_ref", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addCheckConstraint("statements_period_ck", sql`period_end > period_start`)
      .addUniqueConstraint("statements_period_revision_uq", [
        "publisher_id",
        "currency",
        "period_start",
        "period_end",
        "revision",
      ])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("statements").execute();
  },
};
