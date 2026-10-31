import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Program approval requests (DM-024, WP-4.10). A row records that a publisher asked for approval of a program for one
// property. It never records that the program is approved: approval is read from the network-reported state in the
// program's latest source revision (spec §5 Program participation). One row per property and program (DM-024 uniqueness).
export const programApprovals: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("publisher_program_approvals")
      .addColumn("organization_id", "text", (column) =>
        column.notNull().references("organizations.id").onDelete("cascade"),
      )
      .addColumn("property_id", "text", (column) => column.notNull())
      .addColumn("program_id", "text", (column) => column.notNull().references("programs.id").onDelete("cascade"))
      .addColumn("requested_at", "timestamptz", (column) => column.notNull())
      .addColumn("requested_by_type", "text", (column) => column.notNull())
      .addColumn("requested_by_id", "text", (column) => column.notNull())
      .addPrimaryKeyConstraint("publisher_program_approvals_pk", ["property_id", "program_id"])
      // A request can only name a property of its own organization, as the eligibility decisions do.
      .addForeignKeyConstraint(
        "publisher_program_approvals_property_org_fk",
        ["property_id", "organization_id"],
        "properties",
        ["id", "organization_id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists publisher_program_approvals`.execute(db);
  },
};
