import type { BulkJob, BulkJobRow, BulkJobState, BulkJobStore } from "@moneytrap/app/src/ports/bulk-job-store";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for bulk jobs. A job is keyed by organization and submission, so tenants never share one. */
export class FakeBulkJobStore implements BulkJobStore {
  readonly jobs = new Map<string, BulkJob>();

  async create(job: BulkJob): Promise<boolean> {
    const key = keyOf(job.organizationId, job.submissionId);
    if (this.jobs.has(key)) return false;
    this.jobs.set(key, structuredClone(job));
    return true;
  }

  async find(organizationId: Id<"organization">, submissionId: string): Promise<BulkJob | null> {
    const job = this.jobs.get(keyOf(organizationId, submissionId));
    return job ? structuredClone(job) : null;
  }

  async saveRow(organizationId: Id<"organization">, submissionId: string, row: BulkJobRow): Promise<void> {
    const job = this.jobs.get(keyOf(organizationId, submissionId));
    if (!job) return;
    const index = job.rows.findIndex((stored) => stored.row === row.row);
    if (index >= 0) job.rows[index] = { ...row };
  }

  async setState(organizationId: Id<"organization">, submissionId: string, state: BulkJobState): Promise<void> {
    const job = this.jobs.get(keyOf(organizationId, submissionId));
    if (job) job.state = state;
  }
}

function keyOf(organizationId: string, submissionId: string): string {
  return `${organizationId}|${submissionId}`;
}
