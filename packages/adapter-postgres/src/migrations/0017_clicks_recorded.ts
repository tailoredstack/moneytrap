import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// The freshness check reads the clicks recorded since a cutoff (WP-5.9). Without an index on recorded_at, every report
// request would scan the whole clicks table, across every organization, to find the recent ones.
export const clicksRecorded: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.createIndex("clicks_recorded_idx").on("clicks").column("recorded_at").execute();
  },

  async down(db: Kysely<unknown>) {
    await sql`drop index if exists clicks_recorded_idx`.execute(db);
  },
};
