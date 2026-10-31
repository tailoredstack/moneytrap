import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Risk flags (DM-060, WP-5.10). A flag is evidence that a rule matched; it never changes a click or a link. The unique key
// on (rule, link, subject) makes a rescan of the same clicks a no-op.
export const riskFlags: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("risk_flags")
      .addColumn("id", "text", (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()::text`))
      .addColumn("link_id", "text", (column) => column.notNull())
      .addColumn("rule_code", "text", (column) => column.notNull())
      .addColumn("subject_key", "text", (column) => column.notNull())
      .addColumn("severity", "text", (column) => column.notNull())
      .addColumn("state", "text", (column) => column.notNull().defaultTo("open"))
      .addColumn("policy_version", "integer", (column) => column.notNull())
      .addColumn("evidence", "jsonb", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint("risk_flags_rule_link_subject_uq", ["rule_code", "link_id", "subject_key"])
      .execute();
    // The burst scan filters on occurrence time across all links. The click index leads with link_id, so it cannot serve that.
    await db.schema.createIndex("clicks_occurred_idx").on("clicks").column("occurred_at").execute();
  },

  async down(db: Kysely<unknown>) {
    await sql`drop index if exists clicks_occurred_idx`.execute(db);
    await sql`drop table if exists risk_flags`.execute(db);
  },
};
