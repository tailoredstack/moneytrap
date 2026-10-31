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
import type { BulkJob, BulkJobRow, BulkJobState, BulkJobStore, BulkRowClaim } from "../ports/bulk-job-store";
import type {
  LinkAudit,
  LinkEvent,
  LinkPolicy,
  LinkRecord,
  LinkStore,
  LinkWritePrecondition,
  RowClaimFence,
} from "../ports/link-store";
import type { PropertyReviewRecord, PropertyReviewStore } from "../ports/property-review-store";
import type { RouteCache } from "../ports/route-cache";
import { type BulkDeps, MAX_BULK_CSV_BYTES, parseCsv, readBulkJob, runBulkJob, submitBulkJob } from "./bulk";
import { allowsHost, revokeLinkAction } from "./link-actions";

const orgId = fixed("organization", 1);
const otherOrgId = fixed("organization", 2);
const publisherId = fixed("publisher", 1);
const propertyId = fixed("property", 1);
const otherPropertyId = fixed("property", 2);
const approvedProgram = fixed("program", 1);
const ineligibleProgram = fixed("program", 2);
const submissionId = "sub-2026-10-31-a";
const allowedHost = "shop.example.com";
// The test clock moves only when a test moves it, so a claim's lease can be let lapse on purpose.
let currentTime = new Date("2026-10-31T10:20:00.000Z");
const clock = { now: () => currentTime };
const LEASE_MS = 5 * 60 * 1000;
function advanceClock(ms: number): void {
  currentTime = new Date(currentTime.getTime() + ms);
}
function claimFor(owner: string): BulkRowClaim {
  return { owner, now: clock.now(), expiresAt: new Date(clock.now().getTime() + LEASE_MS) };
}

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
  // Runs during the gate read, before a link is written, so a test can stall a run past its lease there.
  onFind: (() => void) | null = null;
  constructor(private readonly live: { status: "approved" | "suspended"; orgId: Id<"organization"> }) {}
  async find(id: Id<"property">): Promise<PropertyReviewRecord | null> {
    this.onFind?.();
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
  // Refuses every version-checked update, as a store does when a revoke cannot land.
  refuseUpdates = false;
  // Whether a bulk row claim still holds, and a hook that runs before each update, so a test can take a row over mid-write.
  rowClaimHolds: ((claim: RowClaimFence) => boolean) | null = null;
  beforeUpdate: (() => void) | null = null;
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
  async update(write: {
    organizationId: Id<"organization">;
    expectedVersion: number;
    record: LinkRecord;
    audit: LinkAudit;
    event: LinkEvent;
    precondition: LinkWritePrecondition | null;
  }) {
    this.beforeUpdate?.();
    if (this.refuseUpdates) return false;
    const stored = this.rows.get(write.record.link.id);
    if (!stored || stored.organizationId !== write.organizationId) return false;
    if (stored.link.version !== write.expectedVersion) return false;
    if (!this.holds(write.precondition)) return false;
    this.rows.set(write.record.link.id, structuredClone(write.record));
    return true;
  }
  private holds(precondition: LinkWritePrecondition | null): boolean {
    if (!precondition) return true;
    if (precondition.rowClaim && !this.rowClaimHolds?.(precondition.rowClaim)) return false;
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

// The in-memory job store. A claim is refused for a row another run holds under a live lease, and for a final row. A save
// is refused for a row this claim does not hold. The hook runs first in a save, so a test can have another run act while
// this one works on the row.
class MemoryJobs implements BulkJobStore {
  readonly jobs = new Map<string, BulkJob>();
  failSaveOfRow: number | null = null;
  // Rows another run has claimed: a claim on one of these loses here.
  readonly claimedElsewhere = new Set<number>();
  beforeSave: ((row: number) => void) | null = null;
  // Runs before a claim is checked, so a test can have another run finish the row after this run took its snapshot.
  beforeClaim: ((row: number) => void) | null = null;
  private readonly claims = new Map<string, { owner: string; expiresAt: Date }>();

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
  async claimRow(organizationId: Id<"organization">, submission: string, row: number, claim: BulkRowClaim) {
    this.beforeClaim?.(row);
    if (this.claimedElsewhere.has(row)) return false;
    const current = this.jobs.get(`${organizationId}|${submission}`)?.rows.find((stored) => stored.row === row);
    const key = `${organizationId}|${submission}|${row}`;
    const held = this.claims.get(key);
    const lapsed = !held || held.expiresAt.getTime() <= claim.now.getTime();
    const open = current?.status === "pending" || (current?.status === "processing" && lapsed);
    if (!current || !open) return false;
    current.status = "processing";
    this.claims.set(key, { owner: claim.owner, expiresAt: claim.expiresAt });
    return true;
  }
  async saveRow(organizationId: Id<"organization">, submission: string, row: BulkJobRow, owner: string) {
    if (this.failSaveOfRow === row.row) {
      this.failSaveOfRow = null;
      throw new Error("crash after the link commit, before the row is saved");
    }
    this.beforeSave?.(row.row);
    const job = this.jobs.get(`${organizationId}|${submission}`);
    if (!job) return false;
    const index = job.rows.findIndex((stored) => stored.row === row.row);
    const current = job.rows[index];
    const open = current?.status === "pending" || current?.status === "processing";
    const key = `${organizationId}|${submission}|${row.row}`;
    const held = this.claims.get(key)?.owner === owner;
    if (!current || !open || !held) return false;
    job.rows[index] = { ...row };
    if (row.status !== "processing") this.claims.delete(key);
    return true;
  }
  async setState(organizationId: Id<"organization">, submission: string, state: BulkJobState) {
    const job = this.jobs.get(`${organizationId}|${submission}`);
    if (job) job.state = state;
  }
  // Whether the row is still processing under this owner's claim, the check a row-fenced link write makes.
  holdsRow(claim: RowClaimFence): boolean {
    const row = this.jobs.get(`${claim.organizationId}|${claim.submissionId}`)?.rows.find((r) => r.row === claim.row);
    const key = `${claim.organizationId}|${claim.submissionId}|${claim.row}`;
    return row?.status === "processing" && this.claims.get(key)?.owner === claim.owner;
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

// Route cache writes are not under test here. The no-op keeps the publish step of a link write satisfied.
const noRouteCache: RouteCache = {
  async readServerTime() {
    return 0;
  },
  async get() {
    return null;
  },
  async put() {},
  async publishVersion() {},
};

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
  const properties = new MemoryProperties({ status: live.status, orgId: options.orgId ?? orgId });
  links.rowClaimHolds = (claim) => jobs.holdsRow(claim);
  const deps: BulkDeps = {
    jobs,
    links: {
      links,
      properties,
      policy: policyFor(live),
      routeCache: noRouteCache,
    },
  };
  return { deps, links, jobs, live, properties };
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

  test("a header-only CSV with no data rows is refused", async () => {
    const { deps, jobs } = setup();
    const result = await submitBulkJob(ctxFor(), deps, {
      organizationId: orgId,
      propertyId,
      submissionId,
      csv: "program_id,destination\n",
    });
    expect(result).toEqual({ ok: false, code: "VALIDATION_FAILED" });
    expect(jobs.jobs.size).toBe(0);
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
    expect(result.value.state).toBe("completed");
    expect(result.value.outcome).toBe("partial");
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
    expect(result.value.outcome).toBe("failed");
  });

  test("a crash after a link commit, before its row is saved, resumes without a duplicate link (TP-W5-015)", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(10)) });
    jobs.failSaveOfRow = 4;
    await expect(runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId })).rejects.toThrow("crash");
    expect(links.rows.size).toBe(4);

    advanceClock(LEASE_MS + 1);
    const resumed = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!resumed.ok) throw new Error("expected the resumed run to succeed");
    expect(resumed.value.state).toBe("completed");
    expect(resumed.value.processed).toBe(10);
    expect(links.rows.size).toBe(10);
    const linkIds = resumed.value.rows.map((row) => row.linkId);
    expect(new Set(linkIds).size).toBe(10);
  });

  test("a row another runner has claimed is left to that runner, and the job stays running", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(2)) });
    jobs.claimedElsewhere.add(1);
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(links.rows.size).toBe(1);
    expect(result.value.rows.map((row) => row.status)).toEqual(["pending", "created"]);
    expect(result.value.state).toBe("running");
  });

  test("a row another run finished after this run took its snapshot is not started again", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    // This run's snapshot shows the row as processing, from a run that stopped. Another run rejects it before the claim.
    const stored = jobs.jobs.get(`${orgId}|${submissionId}`)?.rows[0];
    if (!stored) throw new Error("fixture: row missing");
    stored.status = "processing";
    jobs.beforeClaim = () => {
      stored.status = "rejected";
      stored.code = "STATE_CONFLICT";
      stored.reason = "property_not_approved";
    };
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(links.rows.size).toBe(0);
    expect(result.value.rows.map((row) => row.status)).toEqual(["rejected"]);
  });

  test("reading a job without a signed-in user is refused", async () => {
    const { deps } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    const result = await readBulkJob(ctxFor(null), deps, { organizationId: orgId, submissionId });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  test("a row held under a live claim is left to its owner, and the job stays running", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    await jobs.claimRow(orgId, submissionId, 1, claimFor("run-a"));
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(links.rows.size).toBe(0);
    expect(result.value.rows.map((row) => row.status)).toEqual(["processing"]);
    expect(result.value.state).toBe("running");
    expect(result.value.processed).toBe(0);
  });

  test("a run that stalls past its lease writes no link, and leaves the row for the run that holds it", async () => {
    const { deps, links, properties } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    // The stall happens during the gate read, after the claim and before the link write.
    properties.onFind = () => {
      advanceClock(LEASE_MS + 1);
      properties.onFind = null;
    };
    const stalled = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!stalled.ok) throw new Error("expected the run to succeed");
    expect(links.rows.size).toBe(0);
    expect(stalled.value.rows.map((row) => row.status)).toEqual(["processing"]);
    expect(stalled.value.state).toBe("running");

    // The next run takes the lapsed row and creates its link once.
    const resumed = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    expect(resumed.ok && resumed.value.state).toBe("completed");
    expect(links.rows.size).toBe(1);
  });

  test("a rejected row never has an active link: a late draft from a stalled run stays a draft", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    // Another run rejects the row while this run is writing its draft, so this run's save is refused.
    jobs.beforeSave = () => {
      const stored = jobs.jobs.get(`${orgId}|${submissionId}`)?.rows[0];
      if (!stored) return;
      stored.status = "rejected";
      stored.code = "STATE_CONFLICT";
      stored.reason = "property_not_approved";
      stored.linkId = null;
    };
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    jobs.beforeSave = null;
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(result.value.state).toBe("completed");
    expect(result.value.outcome).toBe("failed");
    expect(result.value.rows.map((row) => row.status)).toEqual(["rejected"]);
    const [linkId] = [...links.rows.keys()];
    expect(links.rows.get(linkId ?? "")?.link.status).toBe("draft");
  });

  test("a link the gate refuses at activation rejects its row, and the link stays a draft", async () => {
    const { deps, links } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    links.refuseUpdates = true;
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    expect(result.value.state).toBe("completed");
    expect(result.value.outcome).toBe("failed");
    expect(result.value.rows.map((row) => row.status)).toEqual(["rejected"]);
    const [linkId] = [...links.rows.keys()];
    expect(links.rows.get(linkId ?? "")?.link.status).toBe("draft");
  });

  test("a draft left by a crashed run is activated when the row is retried", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    // The crash lands on the first save after the draft is written, so the draft exists and the row stays processing.
    jobs.failSaveOfRow = 1;
    await expect(runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId })).rejects.toThrow("crash");
    const [linkId] = [...links.rows.keys()];
    expect(links.rows.get(linkId ?? "")?.link.status).toBe("draft");

    advanceClock(LEASE_MS + 1);
    const retried = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    expect(retried.ok && retried.value.state).toBe("completed");
    expect(retried.ok && retried.value.outcome).toBe("succeeded");
    expect(links.rows.get(linkId ?? "")?.link.status).toBe("active");
  });

  test("an activation after another run has taken the row writes nothing", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    // The claim lapses while this run is activating, and another run takes the row before the write lands.
    links.beforeUpdate = () => {
      links.beforeUpdate = null;
      advanceClock(LEASE_MS + 1);
      void jobs.claimRow(orgId, submissionId, 1, claimFor("other-run"));
    };
    const result = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!result.ok) throw new Error("expected the run to succeed");
    const [linkId] = [...links.rows.keys()];
    expect(links.rows.get(linkId ?? "")?.link.status).toBe("draft");
    expect(result.value.state).toBe("running");
    expect(result.value.rows.map((row) => row.status)).toEqual(["processing"]);
  });

  test("a link revoked after an earlier attempt activated it does not let the row finish created", async () => {
    const { deps, links, jobs } = setup();
    await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv: csvOf(validRows(1)) });
    // The crash lands on the final save, after the link is active, so the row stays processing.
    // The first save holds the row, so the second, the final save, is the one that crashes.
    let saves = 0;
    jobs.beforeSave = () => {
      saves += 1;
      if (saves === 2) {
        jobs.beforeSave = null;
        throw new Error("crash after activation, before the row is saved");
      }
    };
    await expect(runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId })).rejects.toThrow("crash");
    const [linkId] = [...links.rows.keys()];
    expect(links.rows.get(linkId ?? "")?.link.status).toBe("active");

    // The link is revoked before the job resumes, so the resumed row must not finish created.
    const revoked = await revokeLinkAction(ctxFor(), deps.links, { organizationId: orgId, linkId: linkId ?? "" });
    expect(revoked.ok).toBe(true);
    advanceClock(LEASE_MS + 1);
    const resumed = await runBulkJob(ctxFor(), deps, { organizationId: orgId, submissionId });
    if (!resumed.ok) throw new Error("expected the resumed run to succeed");
    expect(resumed.value.rows.map((row) => [row.status, row.reason])).toEqual([["rejected", "link_revoked"]]);
    expect(resumed.value.outcome).toBe("failed");
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
    const read = await readBulkJob(ctxFor(), deps, { organizationId: otherOrgId, submissionId });
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

  test("a UTF-8 byte order mark before the header is not part of the first cell", () => {
    expect(parseCsv("\uFEFFprogram_id,destination\nprg_x,https://a.example.com")).toEqual([
      ["program_id", "destination"],
      ["prg_x", "https://a.example.com"],
    ]);
  });

  test("a BOM-prefixed upload is accepted as a job", async () => {
    const { deps } = setup();
    const csv = `\uFEFF${csvOf(validRows(1))}`;
    const result = await submitBulkJob(ctxFor(), deps, { organizationId: orgId, propertyId, submissionId, csv });
    expect(result.ok && result.value.total).toBe(1);
  });

  test("an unclosed quote refuses the whole file", () => {
    expect(parseCsv('a,"unterminated\nb,c')).toBeNull();
  });
});
