import type {
  BulkJob,
  BulkJobRow,
  BulkJobState,
  BulkJobStore,
  BulkRowClaim,
} from "@moneytrap/app/src/ports/bulk-job-store";
import type { Id } from "@moneytrap/domain";
import { type Kysely, sql } from "kysely";
import { withTx } from "../transaction";

interface JobRow {
  organization_id: string;
  submission_id: string;
  property_id: string;
  content_hash: string;
  state: BulkJobState;
}

interface RowRow {
  row_index: number;
  program_id: string | null;
  destination: string | null;
  status: BulkJobRow["status"];
  link_id: string | null;
  code: string | null;
  reason: string | null;
}

// The job row and its rows commit together. The primary key on (organization, submission) makes a second create of the same
// submission insert nothing, and that create returns false with no row written (TP-W5-017).
export function createBulkJobStore(db: Kysely<unknown>): BulkJobStore {
  return {
    async create(job: BulkJob): Promise<boolean> {
      return withTx(db, async (tx) => {
        const { rows } = await sql<{ submission_id: string }>`
          insert into link_bulk_jobs (organization_id, submission_id, property_id, content_hash, state)
          values (${job.organizationId}, ${job.submissionId}, ${job.propertyId}, ${job.contentHash}, ${job.state})
          on conflict (organization_id, submission_id) do nothing
          returning submission_id
        `.execute(tx);
        if (rows.length === 0) return false;
        if (job.rows.length > 0) {
          const columns = job.rows.map((row) => ({
            row_index: row.row,
            program_id: row.programId,
            destination: row.destination,
            status: row.status,
            link_id: row.linkId,
            code: row.code,
            reason: row.reason,
          }));
          await sql`
            insert into link_bulk_rows (organization_id, submission_id, row_index, program_id, destination, status, link_id, code, reason)
            select ${job.organizationId}, ${job.submissionId}, r.row_index, r.program_id, r.destination, r.status, r.link_id, r.code, r.reason
            from json_to_recordset(${JSON.stringify(columns)}::json) as r(
              row_index integer, program_id text, destination text, status text, link_id text, code text, reason text
            )
          `.execute(tx);
        }
        return true;
      });
    },

    async find(organizationId: Id<"organization">, submissionId: string): Promise<BulkJob | null> {
      const job = await sql<JobRow>`
        select organization_id, submission_id, property_id, content_hash, state
        from link_bulk_jobs
        where organization_id = ${organizationId} and submission_id = ${submissionId}
      `.execute(db);
      const [found] = job.rows;
      if (!found) return null;
      const rows = await sql<RowRow>`
        select row_index, program_id, destination, status, link_id, code, reason
        from link_bulk_rows
        where organization_id = ${organizationId} and submission_id = ${submissionId}
        order by row_index
      `.execute(db);
      return {
        organizationId: found.organization_id as Id<"organization">,
        submissionId: found.submission_id,
        propertyId: found.property_id as Id<"property">,
        contentHash: found.content_hash,
        state: found.state,
        rows: rows.rows.map((row) => ({
          row: row.row_index,
          programId: row.program_id,
          destination: row.destination,
          status: row.status,
          linkId: row.link_id,
          code: row.code,
          reason: row.reason,
        })),
      };
    },

    async claimRow(
      organizationId: Id<"organization">,
      submissionId: string,
      row: number,
      claim: BulkRowClaim,
    ): Promise<boolean> {
      const { rows } = await sql<{ row_index: number }>`
        update link_bulk_rows set status = 'processing', claim_owner = ${claim.owner}, claim_expires_at = ${claim.expiresAt}
        where organization_id = ${organizationId} and submission_id = ${submissionId} and row_index = ${row}
          and (status = 'pending' or (status = 'processing' and (claim_expires_at is null or claim_expires_at <= ${claim.now})))
        returning row_index
      `.execute(db);
      return rows.length === 1;
    },

    async saveRow(
      organizationId: Id<"organization">,
      submissionId: string,
      row: BulkJobRow,
      owner: string,
    ): Promise<boolean> {
      const { rows } = await sql<{ row_index: number }>`
        update link_bulk_rows
        set status = ${row.status}, link_id = ${row.linkId}, code = ${row.code}, reason = ${row.reason}, claim_owner = case when ${row.status} = 'processing' then claim_owner else null end, claim_expires_at = case when ${row.status} = 'processing' then claim_expires_at else null end
        where organization_id = ${organizationId} and submission_id = ${submissionId} and row_index = ${row.row}
          and status in ('pending', 'processing') and claim_owner = ${owner}
        returning row_index
      `.execute(db);
      return rows.length === 1;
    },

    async setState(organizationId: Id<"organization">, submissionId: string, state: BulkJobState): Promise<void> {
      await sql`
        update link_bulk_jobs set state = ${state}
        where organization_id = ${organizationId} and submission_id = ${submissionId}
      `.execute(db);
    },
  };
}
