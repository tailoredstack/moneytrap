import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Eligibility decisions (DM-024, WP-4.9). Each row is one evaluation of the pure policy: the inputs it ran on, the
// policy version, and the decision with its reasons and checks. Rows are never updated. A repeat of the same inputs under
// the same policy version hits input_hash and adds nothing (TP-W4-023). A new policy version adds a row beside the old one
// (TP-W4-022), so earlier decisions stay reproducible.
export const eligibility: Migration = {
  async up(db: Kysely<unknown>) {
    // The target of the organization-matched foreign key below. id is already unique, so this adds no new uniqueness.
    await sql`alter table properties add constraint properties_id_organization_uq unique (id, organization_id)`.execute(
      db,
    );

    await db.schema
      .createTable("eligibility_decisions")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("property_id", "text", (column) => column.notNull())
      .addColumn("program_id", "text", (column) => column.notNull().references("programs.id").onDelete("cascade"))
      // The source revision the program facts were read from. Both are null when the program has no revision yet.
      .addColumn("program_revision_seq", "integer")
      .addColumn("source_revision", "text")
      .addColumn("policy_version", "integer", (column) => column.notNull())
      .addColumn("decision", "text", (column) => column.notNull().check(sql`decision in ('allow', 'deny')`))
      .addColumn("reasons", "jsonb", (column) => column.notNull())
      .addColumn("checks", "jsonb", (column) => column.notNull())
      // The exact EligibilityInput the policy ran on, copied from the source facts. Replaying it reproduces the decision.
      .addColumn("inputs", "jsonb", (column) => column.notNull())
      // SHA-256 of the policy version and the canonical inputs. Equal hashes mean an identical evaluation.
      .addColumn("input_hash", "text", (column) => column.notNull())
      .addColumn("evaluated_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("eligibility_decisions_evaluation_uq", [
        "property_id",
        "program_id",
        "policy_version",
        "input_hash",
      ])
      // A decision can only name a property of its own organization. The pair is the target, so the database enforces
      // what the store checks before it writes.
      .addForeignKeyConstraint(
        "eligibility_decisions_property_org_fk",
        ["property_id", "organization_id"],
        "properties",
        ["id", "organization_id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("eligibility_decisions").ifExists().execute();
    await sql`alter table properties drop constraint properties_id_organization_uq`.execute(db);
  },
};
