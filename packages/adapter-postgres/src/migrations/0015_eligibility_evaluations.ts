import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// One row per evaluation of a decision, repeats included (DM-024, WP-5.13). A repeat of the same inputs reuses the stored
// decision row and adds nothing to eligibility_decisions, so the decision row cannot say when the policy last ran. This
// table can: its identity sequence orders evaluations in commit order, and the link gate reads the latest one. Rows are
// append-only, like the decisions they point at.
export const eligibilityEvaluations: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("eligibility_evaluations")
      .addColumn("seq", "bigint", (column) => column.generatedAlwaysAsIdentity().primaryKey())
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("property_id", "text", (column) => column.notNull())
      .addColumn("program_id", "text", (column) => column.notNull().references("programs.id").onDelete("cascade"))
      .addColumn("decision_id", "text", (column) =>
        column.notNull().references("eligibility_decisions.id").onDelete("cascade"),
      )
      .addColumn("evaluated_at", "timestamptz", (column) => column.notNull())
      .execute();
    await db.schema
      .createIndex("eligibility_evaluations_pair_idx")
      .on("eligibility_evaluations")
      .columns(["organization_id", "property_id", "program_id", "seq"])
      .execute();

    // Existing decisions were each evaluated once, so each gets one evaluation at its recorded time, in the same order.
    await sql`insert into eligibility_evaluations (organization_id, property_id, program_id, decision_id, evaluated_at)
      select organization_id, property_id, program_id, id, evaluated_at from eligibility_decisions
      order by evaluated_at, policy_version, id`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists eligibility_evaluations`.execute(db);
  },
};
