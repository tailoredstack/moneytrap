import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// A statement period can be closed only once. Revision remains stored for the contract, but it cannot make a
// second record valid for the same publisher, currency and period (DM-050, WP-6.10).
export const statementClosedPeriod: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("statements").dropConstraint("statements_period_revision_uq").execute();
    await db.schema
      .alterTable("statements")
      .addUniqueConstraint("statements_period_uq", ["publisher_id", "currency", "period_start", "period_end"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("statements").dropConstraint("statements_period_uq").execute();
    await db.schema
      .alterTable("statements")
      .addUniqueConstraint("statements_period_revision_uq", [
        "publisher_id",
        "currency",
        "period_start",
        "period_end",
        "revision",
      ])
      .execute();
  },
};
