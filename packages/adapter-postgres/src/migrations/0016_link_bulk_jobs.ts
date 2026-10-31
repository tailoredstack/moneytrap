import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Bulk CSV jobs and their per-row results (DM-029, WP-5.3). A job is keyed by its organization and submission, so a
// repeat submit finds the job it made. A row is keyed by its job and its position, so each row keeps one final result.
export const linkBulkJobs: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("link_bulk_jobs")
      .addColumn("organization_id", "text", (column) => column.notNull())
      .addColumn("submission_id", "text", (column) => column.notNull())
      .addColumn("property_id", "text", (column) => column.notNull())
      .addColumn("content_hash", "text", (column) => column.notNull())
      .addColumn("state", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addPrimaryKeyConstraint("link_bulk_jobs_pk", ["organization_id", "submission_id"])
      .execute();

    await db.schema
      .createTable("link_bulk_rows")
      .addColumn("organization_id", "text", (column) => column.notNull())
      .addColumn("submission_id", "text", (column) => column.notNull())
      .addColumn("row_index", "integer", (column) => column.notNull())
      .addColumn("program_id", "text")
      .addColumn("destination", "text")
      .addColumn("status", "text", (column) => column.notNull())
      .addColumn("link_id", "text")
      .addColumn("code", "text")
      .addColumn("reason", "text")
      .addColumn("claim_owner", "text")
      .addColumn("claim_expires_at", "timestamptz")
      .addPrimaryKeyConstraint("link_bulk_rows_pk", ["organization_id", "submission_id", "row_index"])
      .addForeignKeyConstraint(
        "link_bulk_rows_job_fk",
        ["organization_id", "submission_id"],
        "link_bulk_jobs",
        ["organization_id", "submission_id"],
        (constraint) => constraint.onDelete("cascade"),
      )
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await sql`drop table if exists link_bulk_rows`.execute(db);
    await sql`drop table if exists link_bulk_jobs`.execute(db);
  },
};
