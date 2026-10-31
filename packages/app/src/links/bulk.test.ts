import { describe, expect, test } from "bun:test";
import {
  approveProperty,
  createWebsiteProperty,
  type EligibilityDecision,
  ID_PREFIXES,
  type Id,
  type IdKind,
  markPropertyVerified,
  type Property,
  parseId,
  requestPropertyVerification,
  submitPropertyForReview,
  suspendProperty,
} from "@moneytrap/domain";
import type { Ctx } from "../ctx";
import type { BulkJob, BulkJobRow, BulkJobState, BulkJobStore } from "../ports/bulk-job-store";
import type {
  LinkAudit,
  LinkEvent,
  LinkPolicy,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
} from "../ports/link-store";
import type { PropertyReviewRecord, PropertyReviewStore } from "../ports/property-review-store";
import { type BulkDeps, MAX_BULK_CSV_BYTES, parseCsv, readBulkJob, runBulkJob, submitBulkJob } from "./bulk";
import { allowsHost, type LinkDeps } from "./link-actions";

const orgId = fixed("organization", 1);
const otherOrgId = fixed("organization", 2);
const publisherId = fixed("publisher", 1);
const propertyId = fixed("property", 1);
const otherPropertyId = fixed("property", 2);
const approvedProgram = fixed("program", 1);
const ineligibleProgram = fixed("program", 2);
const submissionId = "sub-2026-10-31-a";
const allowedHost = "shop.example.com";
const clock = { now: () => new Date("2026-10-31T10:20:00.000Z") };

function fixed<K extends IdKind>(kind: K, sequence: number): Id<K> {
  return parseId(kind, `${ID_PREFIXES[kind]}_${String(sequence).padStart(26, "0")}`) as Id<K>;
}

// Hands out distinct, well-formed IDs for audit and event rows. Link IDs come from the row, not from here.
function ctxFor(id: string | null = fixed("user", 1)): Ctx {
  let sequence = 0;
  const ids = {
    next<K extends IdKind>(kind: K): Id<K> {
      sequence += 1;
      return fixed(kind, 1000 + sequence);
    },
  };
  return { db: undefined as never, clock, ids, actor: { type: "user", id } };
}

// Builds a property through the domain state machine. Approved and suspended are the states the gate distinguishes.
function propertyIn(status: "approved" | "suspended", id: Id<"property">): Property {
  const created = createWebsiteProperty({ id, publisherId, canonicalIdentifier: "example.com" });
  if (!created.ok) throw new Error("fixture: create failed");
  const pending = requestPropertyVerification(created.value);
  if (!pending.ok) throw new Error("fixture: request failed");
  const verified = markPropertyVerified(pending.value);
  if (!verified.ok) throw new Error("fixture: verify failed");
  const review = submitPropertyForReview(verified.value);
  if (!review.ok) throw new Error("fixture: submit failed");
  const approved = approveProperty(review.value);
  if (!approved.ok) throw new Error("fixture: approve failed");
  if (status === "approved") return approved.value;
  const suspended = suspendProperty(approved.value);
  if (!suspended.ok) throw new Error("fixture: suspend failed");
  return suspended.value;
}

const allowEligibility: EligibilityDecision = { decision: "allow", policyVersion: 1, checks: [] };
const denyEligibility: EligibilityDecision = {
  decision: "deny",
  policyVersion: 1,
  checks: [],
  reasons: ["geography"],
} as EligibilityDecision;

class MemoryProperties implements PropertyReviewStore {
  constructor(private readonly live: { status: "approved" | "suspended"; orgId: Id<"organization"> }) {}
  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    if (id !== propertyId && id !== otherPropertyId) return null;
    return { property: propertyIn(this.live.status, id), organizationId: this.live.orgId };
  }
  async recordTransition() {
    return false;
  }
  async auditTrail() {
    return [];
  }
}

// Models the link adapter contract: an insert writes its row or nothing. The primary key refuses a second row with the same
// ID, and the precondition is checked against the same live state the gate read.
class MemoryLinks implements LinkStore {
  readonly rows = new Map<string, LinkRecord>();
  constructor(private readonly live: Live) {}

  async find(organizationId: Id<"organization">, id: Id<"link">) {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? structuredClone(row) : null;
  }
  async insert(write: {
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }) {
    if (this.rows.has(write.record.link.id)) return false;
    if (!this.holds(write.precondition)) return false;
    this.rows.set(write.record.link.id, structuredClone(write.record));
    return true;
  }
  async update() {
    return false;
  }
  private holds(precondition: LinkWritePrecondition | null): boolean {
    if (!precondition) return true;
    return (
      this.live.status === "approved" &&
      this.live.decisions.get(precondition.programId)?.decision === "allow" &&
      allowsHost([allowedHost], precondition.host)
    );
  }
}

interface Live {
  status: "approved" | "suspended";
  decisions: Map<string, EligibilityDecision>;
}

// The in-memory job store, with a switch that fails one row save, which is how a crash between a link commit and its row
// save is simulated.
class MemoryJobs implements BulkJobStore {
  readonly jobs = new Map<string, BulkJob>();
  failSaveOfRow: number | null = null;

  async create(job: BulkJob) {
    const key = `${job.organizationId}|${job.submissionId}`;
    if (this.jobs.has(key)) return false;
    this.jobs.set(key, structuredClone(job));
    return true;
  }
  async find(organizationId: Id<"organization">, submission: string) {
    const job = this.jobs.get(`${organizationId}|${submission}`);
    return job ? structuredClone(job) : null;
  }
  async saveRow(organizationId: Id<"organization">, submission: string, row: BulkJobRow) {
    if (this.failSaveOfRow === row.row) {
      this.failSaveOfRow = null;
      throw new Error("crash after the link commit, before the row is saved");
    }
    const job = this.jobs.get(`${organizationId}|${submission}`);
    if (!job) return;
    const index = job.rows.findIndex((stored) => stored.row === row.row);
    if (index >= 0) job.rows[index] = { ...row };
  }
  async setState(organizationId: Id<"organization">, submission: string, state: BulkJobState) {
    const job = this.jobs.get(`${organizationId}|${submission}`);
    if (job) job.state = state;
  }
}

function policyFor(live: Live): LinkPolicy {
  return {
    async allowedHosts() {
      return [allowedHost];
    },
    async latestEligibility(_org, _property, program) {
      return live.decisions.get(program) ?? null;
    },
  };
}

function setup(options: { status?: "approved" | "suspended"; orgId?: Id<"organization"> } = {}) {
  const live: Live = {
    status: options.status ?? "approved",
    decisions: new Map([
      [approvedProgram, allowEligibility],
      [ineligibleProgram, denyEligibility],
    ]),
  };
  const links = new MemoryLinks(live);
  const jobs = new MemoryJobs();
  const deps: BulkDeps = {
    jobs,
    links: {
      links,
      properties: new MemoryProperties({ status: live.status, orgId: options.orgId ?? orgId }),
      policy: policyFor(live),
    } as LinkDeps,
  };
  return { deps, links, jobs, live };
}

function csvOf(rows: string[][]): string {
  return ["program_id,destination", ...rows.map((cells) => cells.join(","))].join("\n");
}

function validRows(count: number): string[][] {
  return Array.from({ length: count }, (_, index) => [approvedProgram, `https://${allowedHost}/item/${index}`]);
}

describe("bulk CSV submit (TP-W5-017, TP-W5-018, WP-5.3)", () => {
  test("a repeat with the same key and content returns the first job and writes nothing new", async () => {
    const { deps, jobs } = setup();
    const csv = csvOf(validRows(3));
    const first = await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv });
    const second = await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv });
    expect(first.ok && second.ok).toBe(true);
    expect(jobs.jobs.size).toBe(1);
    expect(second.ok && second.value.total).toBe(3);
  });

  test("the same key with different content is a conflict, not a replay", async () => {
    const { deps } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(2)) });
    const other = await submitBulkJob(ctxFor(), deps, {
      organizationId: orgId,
      propertyId,
      submissionId,
      csv: csvOf(validRows(3)),
    });
    expect(other).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("a CSV over the size limit is refused before any row is read", async () => {
    const { deps, jobs } = setup();
    const csv = `program_id,destination\n${"x".repeat(MAX_BULK_CSV_BYTES)}`;
    const result = await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv });
    expect(result).toEqual({ ok: false, code: "PAYLOAD_TOO_LARGE" });
    expect(jobs.jobs.size).toBe(0);
  });

  test("a header that is not program_id,destination is refused as a whole file", async () => {
    const { deps, jobs } = setup();
    const result = await submitBulkJob(ctxFor(), deps, {
      organizationId: orgId,
      propertyId,
      submissionId,
      csv: "destination,program_id\nhttps://shop.example.com,prg_x",
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(jobs.jobs.size).toBe(0);
  });

  test("a property of another organization is RESOURCE_NOT_FOUND", async () => {
    const { deps } = setup({ orgId: otherOrgId });
    const result = await submitBulkJob(ctxFor(), deps, {
      organizationId: orgId,
      propertyId,
      submissionId,
      csv: csvOf(validRows(1)),
    });
    expect(result).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });
});

describe("bulk CSV run (TP-W5-013, TP-W5-014, TP-W5-015, WP-5.3)", () => {
  test("1,000 valid rows: every row is created and the job completes (TP-W5-013)", async () => {
    const { deps, links } = setup();
    await submitBulkJob(ctxFor(), deps, {
      organizationId: orgId,
      propertyId,
      submissionId,
      csv: csvOf(validRows(1000)),
    });
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    expect(result.ok && result.value.state).toBe("completed");
    expect(result.ok && result.value.processed).toBe(1000);
    expect(result.ok && result.value.failed).toBe(0);
    expect(links.rows.size).toBe(1000);
  });

  test("5 bad rows among 1,000: 995 created, 5 rejected with their row numbers (TP-W5-014)", async () => {
    const { deps, links } = setup();
    const rows = validRows(1000);
    rows[9] = ["not-a-program", "https://shop.example.com/x"];
    rows[99] = [approvedProgram, "   "];
    rows[199] = [approvedProgram, "javascript:alert(1)"];
    rows[299] = [ineligibleProgram, "https://shop.example.com/y"];
    rows[399] = [approvedProgram, "https://evil.example.org/z"];
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(rows) });
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(result.value.failed).toBe(5);
    expect(links.rows.size).toBe(995);
    const rejected = result.value.rows.filter((row) => row.status === "rejected");
    expect(rejected.map((row) => [row.row, row.code, row.reason])).toEqual([
      [10, "VALIDATION_FAILED", "invalid_program_id"],
      [100, "VALIDATION_FAILED", "destination_missing"],
      [200, "VALIDATION_FAILED", null],
      [300, "PROGRAM_INELIGIBLE", "geography"],
      [400, "VALIDATION_FAILED", null],
    ]);
  });

  test("a row runs through the same guard as a single create: a suspended property rejects every row", async () => {
    const { deps, links } = setup({ status: "suspended" });
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(2)) });
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(result.value.rows.map((row) => [row.status, row.code, row.reason])).toEqual([
      ["rejected", "STATE_CONFLICT", "property_not_approved"],
      ["rejected", "STATE_CONFLICT", "property_not_approved"],
    ]);
    expect(links.rows.size).toBe(0);
  });

  test("a crash after a link commit, before its row is saved, resumes without a duplicate link (TP-W5-015)", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(10)) });
    jobs.failSaveOfRow = 4;
    await expect(runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId })).rejects.toThrow("crash");
    expect(links.rows.size).toBe(4);

    const resumed = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!resumed.ok) throw new Error("expected the resumed run to succeed");
    expect(resumed.value.state).toBe("completed");
    expect(resumed.value.processed).toBe(10);
    expect(links.rows.size).toBe(10);
    const linkIds = resumed.value.rows.map((row) => row.linkId);
    expect(new Set(linkIds).size).toBe(10);
  });

  test("running a completed job again writes nothing (replay safety)", async () => {
    const { deps, links } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(3)) });
    await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    const again = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    expect(again.ok && again.value.state).toBe("completed");
    expect(links.rows.size).toBe(3);
  });

  test("a rejected row is final: a later retry does not create it after eligibility changes", async () => {
    const { deps, links, live } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(2)) });
    live.status = "suspended";
    await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    live.status = "approved";
    await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    expect(links.rows.size).toBe(0);
  });

  test("another organization cannot read or run the job", async () => {
    const { deps } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    const read = await readBulkJob(deps, { organizationId: otherOrgId, submissionId });
    const run = await runBulkJob(ctxFor(), deps, { organizationId: otherOrgId, submissionId });
    expect(read).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
    expect(run).toEqual({ ok: false, code: "RESOURCE_NOT_FOUND" });
  });

  test("a caller without a signed-in user is refused", async () => {
    const { deps } = setup();
    const result = await submitBulkJob(ctxFor(null), deps, {
      organizationId: orgId,
      propertyId,
      submissionId,
      csv: csvOf(validRows(1)),
    });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });
});

describe("parseCsv", () => {
  test("handles quoted commas, doubled quotes, CRLF, and skips blank lines", () => {
    expect(parseCsv('a,"b,c","say ""hi"""\r\n\r\nx,y,z\n')).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["x", "y", "z"],
    ]);
  });

  test("an unclosed quote refuses the whole file", () => {
    expect(parseCsv('a,"unterminated\nb,c')).toBeNull();
  });
});
