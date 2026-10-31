import type { Id } from "@moneytrap/domain";

// A bulk job is pending until its runner starts it, running while rows are processed, and completed once every row has a
// final result (DM-029, UC12).
export type BulkJobState = "queued" | "running" | "completed";

// A row is pending until a run claims it, and processing while that run works on it. A created row carries the link it
// made. A rejected row carries the code and reason its link action returned. Created and rejected are final: no run
// changes them again, so a changed eligibility answer cannot slip in later.
export type BulkRowStatus = "pending" | "processing" | "created" | "rejected";

export interface BulkJobRow {
  // The 1-based position of the data row in the CSV, not counting the header.
  row: number;
  programId: string | null;
  destination: string | null;
  status: BulkRowStatus;
  linkId: string | null;
  code: string | null;
  reason: string | null;
}

export interface BulkJob {
  organizationId: Id<"organization">;
  // The caller's stable key for the submission. A repeat with the same key returns this job, and the key is unique per
  // organization.
  submissionId: string;
  propertyId: Id<"property">;
  // A hash of the uploaded CSV. A repeat with the same key but different content is refused, not replayed.
  contentHash: string;
  state: BulkJobState;
  rows: BulkJobRow[];
}

// Jobs and their rows. The store writes a whole job at once, and it writes each row result on its own, so a crash
// between two rows keeps the rows already final.
// One run's hold on a row. The claim lapses at expiresAt, so a run that stopped releases its rows to a later run.
export interface BulkRowClaim {
  owner: string;
  now: Date;
  expiresAt: Date;
}

export interface BulkJobStore {
  // Writes the job with its rows. Returns false, and writes nothing, when the organization already has this submission.
  create(job: BulkJob): Promise<boolean>;
  find(organizationId: Id<"organization">, submissionId: string): Promise<BulkJob | null>;
  // Gives a row to one run. A pending row moves to processing for the claim. A processing row moves only when its earlier
  // claim has lapsed (expiresAt at or before now), so a live run is never taken over. Returns false otherwise.
  claimRow(
    organizationId: Id<"organization">,
    submissionId: string,
    row: number,
    claim: BulkRowClaim,
  ): Promise<boolean>;
  // Stores a row's result, but only while the row is not final and this owner still holds it. Returns false, and stores
  // nothing, when another run has taken the row or it is already final.
  saveRow(organizationId: Id<"organization">, submissionId: string, row: BulkJobRow, owner: string): Promise<boolean>;
  setState(organizationId: Id<"organization">, submissionId: string, state: BulkJobState): Promise<void>;
}
