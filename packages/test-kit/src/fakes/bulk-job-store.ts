import type {
  BulkJob,
  BulkJobRow,
  BulkJobState,
  BulkJobStore,
  BulkRowClaim,
} from "@moneytrap/app/src/ports/bulk-job-store";
import type { Id } from "@moneytrap/domain";

/** In-memory reference adapter for bulk jobs. A job is keyed by organization and submission, so tenants never share one. */
export class FakeBulkJobStore implements BulkJobStore {
  readonly jobs = new Map<string, BulkJob>();
  // The claim each processing row is held under, keyed like the row itself.
  private readonly claims = new Map<string, { owner: string; expiresAt: Date }>();

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

  async claimRow(
    organizationId: Id<"organization">,
    submissionId: string,
    row: number,
    claim: BulkRowClaim,
  ): Promise<boolean> {
    const current = this.jobs.get(keyOf(organizationId, submissionId))?.rows.find((stored) => stored.row === row);
    const key = ownerKey(organizationId, submissionId, row);
    const held = this.claims.get(key);
    const lapsed = !held || held.expiresAt.getTime() <= claim.now.getTime();
    const open = current?.status === "pending" || (current?.status === "processing" && lapsed);
    if (!current || !open) return false;
    current.status = "processing";
    this.claims.set(key, { owner: claim.owner, expiresAt: claim.expiresAt });
    return true;
  }

  async saveRow(
    organizationId: Id<"organization">,
    submissionId: string,
    row: BulkJobRow,
    owner: string,
  ): Promise<boolean> {
    const job = this.jobs.get(keyOf(organizationId, submissionId));
    if (!job) return false;
    const index = job.rows.findIndex((stored) => stored.row === row.row);
    const current = job.rows[index];
    const open = current?.status === "pending" || current?.status === "processing";
    const key = ownerKey(organizationId, submissionId, row.row);
    const held = this.claims.get(key)?.owner === owner;
    if (!current || !open || !held) return false;
    job.rows[index] = { ...row };
    if (row.status !== "processing") this.claims.delete(key);
    return true;
  }

  async setState(organizationId: Id<"organization">, submissionId: string, state: BulkJobState): Promise<void> {
    const job = this.jobs.get(keyOf(organizationId, submissionId));
    if (job) job.state = state;
  }
}

function keyOf(organizationId: string, submissionId: string): string {
  return `${organizationId}|${submissionId}`;
}

function ownerKey(organizationId: string, submissionId: string, row: number): string {
  return `${organizationId}|${submissionId}|${row}`;
}
