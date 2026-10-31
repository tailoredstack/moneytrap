import { type Id, parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { BulkJob, BulkJobRow, BulkJobState, BulkJobStore } from "../ports/bulk-job-store";
import { createActiveLink, type LinkActionDenial, type LinkDeps } from "./link-actions";

// Bulk CSV link creation (UC12, API-041, API-042, DM-029, WP-5.3). A job is submitted once under a stable key, and each
// row then goes through createActiveLink, the same action and guards as a single create (UC11). A row's result is final
// when it is saved, so a retry never repeats a row that already has one.

export const MAX_BULK_CSV_BYTES = 1024 * 1024;
export const MAX_BULK_ROWS = 10_000;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEADER = ["program_id", "destination"];

export interface BulkDeps {
  jobs: BulkJobStore;
  links: LinkDeps;
}

// A job-level refusal. PAYLOAD_TOO_LARGE is checked before the CSV is parsed, so no row is read from an oversized upload.
export type BulkDenial =
  | { ok: false; code: "UNAUTHENTICATED" | "VALIDATION_FAILED" | "RESOURCE_NOT_FOUND" | "STATE_CONFLICT" }
  | { ok: false; code: "PAYLOAD_TOO_LARGE" };

export interface BulkJobView {
  submissionId: string;
  propertyId: Id<"property">;
  state: BulkJobState;
  total: number;
  processed: number;
  failed: number;
  rows: BulkJobRow[];
}

export type BulkResult = { ok: true; value: BulkJobView } | BulkDenial;

export interface SubmitBulkInput {
  organizationId: Id<"organization">;
  propertyId: string;
  submissionId: string;
  csv: string;
}

export interface BulkJobRef {
  organizationId: Id<"organization">;
  submissionId: string;
}

// Accepts the CSV as a job. A repeat with the same submission key and the same content returns the job already
// stored, and writes nothing (TP-W5-017). The same key with other content is a conflict. Invalid rows are stored as
// rejected with their reason, so the job still runs and reports them per row (TP-W5-014).
export async function submitBulkJob(ctx: Ctx, deps: BulkDeps, input: SubmitBulkInput): Promise<BulkResult> {
  if (!signedIn(ctx)) return { ok: false, code: "UNAUTHENTICATED" };
  if (!SUBMISSION_ID.test(input.submissionId)) return { ok: false, code: "VALIDATION_FAILED" };
  const propertyId = parseId("property", input.propertyId);
  if (propertyId === null) return { ok: false, code: "VALIDATION_FAILED" };
  if (new TextEncoder().encode(input.csv).byteLength > MAX_BULK_CSV_BYTES)
    return { ok: false, code: "PAYLOAD_TOO_LARGE" };

  const contentHash = await sha256Hex(`${propertyId}\n${input.csv}`);
  const sameSubmission = (job: BulkJob): BulkResult =>
    job.contentHash === contentHash ? { ok: true, value: viewOf(job) } : { ok: false, code: "STATE_CONFLICT" };
  const existing = await deps.jobs.find(input.organizationId, input.submissionId);
  if (existing) return sameSubmission(existing);

  const property = await deps.links.properties.find(propertyId);
  if (!property || property.organizationId !== input.organizationId) return { ok: false, code: "RESOURCE_NOT_FOUND" };

  const records = parseCsv(input.csv);
  const header = records?.[0];
  if (!records || !header || !isHeader(header)) return { ok: false, code: "VALIDATION_FAILED" };
  const dataRecords = records.slice(1);
  if (dataRecords.length > MAX_BULK_ROWS) return { ok: false, code: "VALIDATION_FAILED" };

  const job: BulkJob = {
    organizationId: input.organizationId,
    submissionId: input.submissionId,
    propertyId,
    contentHash,
    state: "queued",
    rows: dataRecords.map((cells, index) => rowOf(cells, index + 1)),
  };
  if (await deps.jobs.create(job)) return { ok: true, value: viewOf(job) };
  // A concurrent submit with the same key won the write, so this one answers with the job that was stored.
  const stored = await deps.jobs.find(input.organizationId, input.submissionId);
  return stored ? sameSubmission(stored) : { ok: false, code: "STATE_CONFLICT" };
}

// Runs every pending row of a job through createActiveLink, then marks the job completed. A row that already has a final
// result is skipped, so a retry after a crash resumes at the first row that is not final (TP-W5-015). A completed job is
// returned as it is.
export async function runBulkJob(ctx: Ctx, deps: BulkDeps, ref: BulkJobRef): Promise<BulkResult> {
  if (!signedIn(ctx)) return { ok: false, code: "UNAUTHENTICATED" };
  const job = await deps.jobs.find(ref.organizationId, ref.submissionId);
  if (!job) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  if (job.state === "completed") return { ok: true, value: viewOf(job) };

  await deps.jobs.setState(ref.organizationId, ref.submissionId, "running");
  const rows: BulkJobRow[] = [];
  for (const row of job.rows) {
    if (row.status !== "pending") {
      rows.push(row);
      continue;
    }
    const final = await processRow(ctx, deps, job, row);
    await deps.jobs.saveRow(ref.organizationId, ref.submissionId, final);
    rows.push(final);
  }
  await deps.jobs.setState(ref.organizationId, ref.submissionId, "completed");
  return { ok: true, value: viewOf({ ...job, state: "completed", rows }) };
}

// Reads a job and its per-row results (API-042). The job is tenant-scoped, so another organization's submission is
// RESOURCE_NOT_FOUND.
export async function readBulkJob(deps: BulkDeps, ref: BulkJobRef): Promise<BulkResult> {
  const job = await deps.jobs.find(ref.organizationId, ref.submissionId);
  return job ? { ok: true, value: viewOf(job) } : { ok: false, code: "RESOURCE_NOT_FOUND" };
}

// Creates the link for one pending row. The link ID is derived from the organization, the submission, and the row, so
// a retry names the same link. If the link already exists, an earlier attempt created it before it saved the row, and
// the row is created with that link. A second link is never written.
async function processRow(ctx: Ctx, deps: BulkDeps, job: BulkJob, row: BulkJobRow): Promise<BulkJobRow> {
  if (row.programId === null || row.destination === null) {
    return { ...row, status: "rejected", code: "VALIDATION_FAILED", reason: "row_incomplete" };
  }
  const linkId = await rowLinkId(job.organizationId, job.submissionId, row.row);
  const result = await createActiveLink(ctx, deps.links, {
    organizationId: job.organizationId,
    propertyId: job.propertyId,
    programId: row.programId,
    destination: row.destination,
    linkId,
  });
  if (result.ok) return { ...row, status: "created", linkId, code: null, reason: null };
  if (await deps.links.links.find(job.organizationId, linkId)) {
    return { ...row, status: "created", linkId, code: null, reason: null };
  }
  return { ...row, status: "rejected", linkId: null, code: result.code, reason: reasonOf(result) };
}

// Validates one data row's shape. A row with the wrong number of cells, an invalid program ID, or an empty destination is
// rejected here, without a link action. Anything else is pending until the runner reaches it.
function rowOf(cells: string[], row: number): BulkJobRow {
  const base: BulkJobRow = {
    row,
    programId: null,
    destination: null,
    status: "pending",
    linkId: null,
    code: null,
    reason: null,
  };
  const [programCell = "", destinationCell = ""] = cells;
  if (cells.length !== HEADER.length) {
    return { ...base, status: "rejected", code: "VALIDATION_FAILED", reason: "wrong_column_count" };
  }
  const programId = parseId("program", programCell.trim());
  if (programId === null)
    return { ...base, status: "rejected", code: "VALIDATION_FAILED", reason: "invalid_program_id" };
  const destination = destinationCell.trim();
  if (destination === "")
    return { ...base, status: "rejected", code: "VALIDATION_FAILED", reason: "destination_missing" };
  return { ...base, programId, destination };
}

// The stored view of a job, with counts that match its rows: processed counts final rows, failed counts rejected ones.
function viewOf(job: BulkJob): BulkJobView {
  return {
    submissionId: job.submissionId,
    propertyId: job.propertyId,
    state: job.state,
    total: job.rows.length,
    processed: job.rows.filter((row) => row.status !== "pending").length,
    failed: job.rows.filter((row) => row.status === "rejected").length,
    rows: job.rows,
  };
}

function reasonOf(denial: LinkActionDenial): string | null {
  if (denial.code === "STATE_CONFLICT") return denial.reason ?? null;
  if (denial.code === "PROGRAM_INELIGIBLE") return denial.reasons.join(",");
  return null;
}

function signedIn(ctx: Ctx): boolean {
  return ctx.actor.type === "user" && ctx.actor.id !== null && parseId("user", ctx.actor.id) !== null;
}

function isHeader(cells: string[]): boolean {
  return cells.length === HEADER.length && cells.every((cell, index) => cell.trim() === HEADER[index]);
}

// The link ID for a row, a valid link ID built from a SHA-256 digest. The alphabet is the 32 characters a link ID body may
// use, so each digest byte maps to one character with no bias (256 is a multiple of 32).
const LINK_BODY = "0123456789abcdefghjkmnpqrstvwxyz";

async function rowLinkId(organizationId: string, submissionId: string, row: number): Promise<Id<"link">> {
  const digest = await sha256Bytes(`${organizationId}|${submissionId}|${row}`);
  const body = [...digest.slice(0, 26)].map((byte) => LINK_BODY[byte % 32]).join("");
  return parseId("link", `lnk_${body}`) as Id<"link">;
}

// RFC 4180 records. Commas separate cells, a quoted cell may hold commas and line breaks, and a doubled quote is a literal
// quote. Blank lines are skipped. An unclosed quote returns null, so a broken file is refused as a whole.
export function parseCsv(text: string): string[][] | null {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  const endRecord = () => {
    if (!(record.length === 1 && record[0] === "")) records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      record.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(cell);
      cell = "";
      endRecord();
    } else cell += ch;
  }
  if (quoted) return null;
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    endRecord();
  }
  return records;
}

async function sha256Bytes(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256Bytes(text))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
