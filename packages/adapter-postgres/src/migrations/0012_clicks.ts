import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Logical click facts (DM-030, WP-5.8). The dedup key is the primary key, so a click emitted twice, or an event replayed
// after a crash, inserts at most one row (CT-013). There is no foreign key to links yet: the link aggregate lands in
// WP-5.2, and a click can outlive a revoked link.
export const clicks: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("clicks")
      .addColumn("dedup_key", "text", (column) => column.notNull())
      .addColumn("link_id", "text", (column) => column.notNull())
      .addColumn("occurred_at", "timestamptz", (column) => column.notNull())
      .addColumn("recorded_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint("clicks_pk", ["dedup_key"])
      .execute();
    await db.schema.createIndex("clicks_link_occurred_idx").on("clicks").columns(["link_id", "occurred_at"]).execute();
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists clicks`.execute(db);
  },
};
