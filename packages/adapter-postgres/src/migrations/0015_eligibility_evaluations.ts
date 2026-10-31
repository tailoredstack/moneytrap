import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// One row per evaluation of a decision, repeats included (DM-024, WP-5.13). A repeat of the same inputs reuses the stored
// decision row and adds nothing to eligibility_decisions, so the decision row cannot say when the policy last ran. This
// table can. Its identity seq is assigned at insert, and the order the link gate reads comes from the property row lock
// that record() holds while it writes. Decisions and evaluations are only removed with the tenant that owns them.
export const eligibilityEvaluations: Migration = {
  async up(db: Kysely<unknown>) {
    // Target of the composite foreign key below. It adds a wider key over columns already unique on their own.
    await sql`alter table eligibility_decisions add constraint eligibility_decisions_scope_uq
      unique (id, organization_id, property_id, program_id)`.execute(db);

    await db.schema
      .createTable("eligibility_evaluations")
      .addColumn("seq", "bigint", (column) => column.generatedAlwaysAsIdentity().primaryKey())
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("property_id", "text", (column) => column.notNull())
      .addColumn("program_id", "text", (column) => column.notNull().references("programs.id").onDelete("cascade"))
      .addColumn("decision_id", "text", (column) => column.notNull())
      .addColumn("evaluated_at", "timestamptz", (column) => column.notNull())
      // An evaluation names a decision of its own tenant, property, and program, so the gate reads the outcome it was given.
      .addForeignKeyConstraint(
        "eligibility_evaluations_decision_fk",
        ["decision_id", "organization_id", "property_id", "program_id"],
        "eligibility_decisions",
        ["id", "organization_id", "property_id", "program_id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .addForeignKeyConstraint(
        "eligibility_evaluations_property_org_fk",
        ["property_id", "organization_id"],
        "properties",
        ["id", "organization_id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();
    await db.schema
      .createIndex("eligibility_evaluations_pair_idx")
      .on("eligibility_evaluations")
      .columns(["organization_id", "property_id", "program_id", "seq"])
      .execute();

    // Existing decisions were each evaluated once. A row-by-row loop inserts them in evaluation order, which the SQL
    // standard does not guarantee for a single insert ... select, so the identity seq follows the recorded time.
    await sql`do $$
      declare r record;
      begin
        for r in select organization_id, property_id, program_id, id, evaluated_at from eligibility_decisions
          order by evaluated_at, policy_version, id
        loop
          insert into eligibility_evaluations (organization_id, property_id, program_id, decision_id, evaluated_at)
          values (r.organization_id, r.property_id, r.program_id, r.id, r.evaluated_at);
        end loop;
      end
      $$`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists eligibility_evaluations`.execute(db);
    await sql`alter table eligibility_decisions drop constraint if exists eligibility_decisions_scope_uq`.execute(db);
  },
};
