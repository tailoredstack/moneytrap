import { type Id, parseId } from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { BulkJob, BulkJobRow, BulkJobState, BulkJobStore } from "../ports/bulk-job-store";
import {
  activateLinkAction,
  createActiveLink,
  type LinkActionDenial,
  type LinkDeps,
  revokeLinkAction,
} from "./link-actions";

// Bulk CSV link creation (UC12, API-041, API-042, DM-029, WP-5.3). A job is submitted once under a stable key, and each
// row then goes through createActiveLink, the same action and guards as a single create (UC11). A row's result is final
// when it is saved, so a retry never repeats a row that already has one.

export const MAX_BULK_CSV_BYTES = 1024 * 1024;
export const MAX_BULK_ROWS = 10_000;
const SUBMISSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const HEADER = ["program_id", "destination"];
// How long a run holds a row before another run may take it over. A live run is not interrupted, and a run that stopped
// releases its rows once this has passed.
const CLAIM_LEASE_MS = 5 * 60 * 1000;

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
  // Set once the job is completed: succeeded when no row was rejected, partial when some were, failed when all were.
  outcome: "succeeded" | "partial" | "failed" | null;
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
  if (dataRecords.length === 0 || dataRecords.length > MAX_BULK_ROWS) return { ok: false, code: "VALIDATION_FAILED" };

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

// Runs the rows of a job through createActiveLink, then marks the job completed once every row is final. A run claims each
// row it works on, and it saves only the rows it still holds. A row a stopped run left at processing is taken over and
// resumed: its link ID is fixed, so a second attempt cannot create a second link (TP-W5-015). A completed job is returned
// as it is.
export async function runBulkJob(ctx: Ctx, deps: BulkDeps, ref: BulkJobRef): Promise<BulkResult> {
  if (!signedIn(ctx)) return { ok: false, code: "UNAUTHENTICATED" };
  const job = await deps.jobs.find(ref.organizationId, ref.submissionId);
  if (!job) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  if (job.state === "completed") return { ok: true, value: viewOf(job) };

  await deps.jobs.setState(ref.organizationId, ref.submissionId, "running");
  // Each run has its own owner, so a row another run takes over cannot be saved by this one.
  const owner: string = ctx.ids.next("event");
  for (const row of job.rows) {
    if (row.status !== "pending" && row.status !== "processing") continue;
    const now = ctx.clock.now();
    const claim = { owner, now, expiresAt: new Date(now.getTime() + CLAIM_LEASE_MS) };
    if (!(await deps.jobs.claimRow(ref.organizationId, ref.submissionId, row.row, claim))) continue;
    const final = await processRow(ctx, deps, job, row, claim.expiresAt, owner);
    // The claim lapsed before the link was written, so nothing was written and another run takes the row.
    if (final === null) continue;
    // A save is refused when another run took the row or it is already final. The row then belongs to that run, so this run
    // writes nothing more for it. The end-of-run sweep below covers any link under a rejected row.
    const saved = await deps.jobs.saveRow(ref.organizationId, ref.submissionId, final, owner);
    if (!saved) continue;
  }

  // The view and the completion check read the stored rows, so another run's results are reported as they are stored. A
  // job completes only when every row is final and no rejected row keeps a live link.
  const latest = await deps.jobs.find(ref.organizationId, ref.submissionId);
  if (!latest) return { ok: false, code: "RESOURCE_NOT_FOUND" };
  const revoked = await revokeRejectedLinks(ctx, deps, ref, latest.rows);
  const activated = await activateCreatedLinks(ctx, deps, ref, latest.rows);
  if (revoked && activated && latest.rows.every((row) => row.status === "created" || row.status === "rejected")) {
    await deps.jobs.setState(ref.organizationId, ref.submissionId, "completed");
    return { ok: true, value: viewOf({ ...latest, state: "completed" }) };
  }
  return { ok: true, value: viewOf(latest) };
}

// A rejected row never keeps a live link. A link under a rejected row's ID can only come from a run that raced for the row,
// and that run may finish after this one, so every run checks the rejected rows at its end. Returns false when a revoke was
// refused, and then the job does not complete, so the next run tries again.
async function revokeRejectedLinks(ctx: Ctx, deps: BulkDeps, ref: BulkJobRef, rows: BulkJobRow[]): Promise<boolean> {
  let clean = true;
  for (const row of rows) {
    if (row.status !== "rejected") continue;
    const linkId = await rowLinkId(ref.organizationId, ref.submissionId, row.row);
    const stored = await deps.links.links.find(ref.organizationId, linkId);
    // Only an active or paused link can be revoked. A draft was never routable, so it is left as it is.
    if (!stored || (stored.link.status !== "active" && stored.link.status !== "paused")) continue;
    const revoked = await revokeLinkAction(ctx, deps.links, { organizationId: ref.organizationId, linkId });
    if (!revoked.ok) clean = false;
  }
  return clean;
}

// Reads a job and its per-row results (API-042). The job is tenant-scoped, so another organization's submission is
// RESOURCE_NOT_FOUND.
export async function readBulkJob(ctx: Ctx, deps: BulkDeps, ref: BulkJobRef): Promise<BulkResult> {
  if (!signedIn(ctx)) return { ok: false, code: "UNAUTHENTICATED" };
  const job = await deps.jobs.find(ref.organizationId, ref.submissionId);
  return job ? { ok: true, value: viewOf(job) } : { ok: false, code: "RESOURCE_NOT_FOUND" };
}

// A created row's link becomes active only here, after the row is final. A link still in draft under a created row is
// activated by any run that sees it. A link that cannot activate, because its gate no longer holds, keeps the job running,
// so the next run tries again.
async function activateCreatedLinks(ctx: Ctx, deps: BulkDeps, ref: BulkJobRef, rows: BulkJobRow[]): Promise<boolean> {
  let clean = true;
  for (const row of rows) {
    if (row.status !== "created") continue;
    const linkId = await rowLinkId(ref.organizationId, ref.submissionId, row.row);
    const stored = await deps.links.links.find(ref.organizationId, linkId);
    if (stored?.link.status !== "draft") continue;
    const activated = await activateLinkAction(ctx, deps.links, { organizationId: ref.organizationId, linkId });
    if (!activated.ok) clean = false;
  }
  return clean;
}

// Creates the link for one pending row. The link ID is derived from the organization, the submission, and the row, so a
// retry names the same link, and a second link is never written. A new link is written as a draft under the fence, so a
// lapsed claim writes nothing (null: left for the run that holds the row). Whatever link the row has, it is settled the
// same way: the row is held before any draft is activated, so a row another run has finalized is never activated.
async function processRow(
  ctx: Ctx,
  deps: BulkDeps,
  job: BulkJob,
  row: BulkJobRow,
  expiresAt: Date,
  owner: string,
): Promise<BulkJobRow | null> {
  if (row.programId === null || row.destination === null) {
    return { ...row, status: "rejected", code: "VALIDATION_FAILED", reason: "row_incomplete" };
  }
  const linkId = await rowLinkId(job.organizationId, job.submissionId, row.row);
  // Look first: a link already stored under this ID is the outcome of an earlier attempt, whatever the store does on a
  // repeat insert.
  if (!(await deps.links.links.find(job.organizationId, linkId))) {
    let lapsed = false;
    const result = await createActiveLink(ctx, deps.links, {
      organizationId: job.organizationId,
      propertyId: job.propertyId,
      programId: row.programId,
      destination: row.destination,
      linkId,
      status: "draft",
      rowClaim: { organizationId: job.organizationId, submissionId: job.submissionId, row: row.row, owner },
      beforeWrite: () => {
        lapsed = ctx.clock.now().getTime() >= expiresAt.getTime();
        return !lapsed;
      },
    });
    if (!result.ok && !(await deps.links.links.find(job.organizationId, linkId))) {
      if (lapsed) return null;
      return { ...row, status: "rejected", linkId: null, code: result.code, reason: reasonOf(result) };
    }
  }
  // The row is held before the link is activated. A row another run has finalized is refused here, so its draft is never
  // activated, and a lost claim leaves the row for the run that holds it.
  const held = await deps.jobs.saveRow(
    job.organizationId,
    job.submissionId,
    { ...row, status: "processing", linkId },
    owner,
  );
  if (!held) return null;
  const stored = await deps.links.links.find(job.organizationId, linkId);
  if (stored?.link.status === "draft") {
    const activated = await activateLinkAction(ctx, deps.links, {
      organizationId: job.organizationId,
      linkId,
      rowClaim: { organizationId: job.organizationId, submissionId: job.submissionId, row: row.row, owner },
    });
    // The gate refused activation, so the row is rejected and its link stays a draft.
    if (!activated.ok)
      return { ...row, status: "rejected", linkId: null, code: activated.code, reason: reasonOf(activated) };
  }
  // A link that is neither a draft nor active is not live. A row that is still processing cannot finish created with it: a
  // link revoked or paused after an earlier attempt activated it is a rejection, not a success.
  if (stored?.link.status !== "active" && stored?.link.status !== "draft") {
    return {
      ...row,
      status: "rejected",
      linkId: null,
      code: "STATE_CONFLICT",
      reason: stored ? `link_${stored.link.status}` : "link_missing",
    };
  }
  return { ...row, status: "created", linkId, code: null, reason: null };
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
    outcome: job.state === "completed" ? outcomeOf(job) : null,
    total: job.rows.length,
    processed: job.rows.filter((row) => row.status === "created" || row.status === "rejected").length,
    failed: job.rows.filter((row) => row.status === "rejected").length,
    rows: job.rows,
  };
}

// The job's result as a whole. A job with any rejected row is never a success.
function outcomeOf(job: BulkJob): "succeeded" | "partial" | "failed" {
  const rejected = job.rows.filter((row) => row.status === "rejected").length;
  if (rejected === 0) return "succeeded";
  return rejected === job.rows.length ? "failed" : "partial";
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
export function parseCsv(input: string): string[][] | null {
  // A UTF-8 byte order mark, which spreadsheet exports often add, is not part of the first cell.
  const text = input.startsWith("﻿") ? input.slice(1) : input;
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
