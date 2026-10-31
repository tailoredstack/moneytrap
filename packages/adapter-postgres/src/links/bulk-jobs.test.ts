import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BulkJob, BulkJobRow } from "@moneytrap/app/src/ports/bulk-job-store";
import { type Id, parseId } from "@moneytrap/domain";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createBulkJobStore } from "./bulk-jobs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const orgId = parseId("organization", "org_01arz3ndektsv4rrffq69g5fav") as Id<"organization">;
const otherOrgId = parseId("organization", "org_01bx5zzkbkactav9wevgemmvrz") as Id<"organization">;
const propertyId = parseId("property", "prp_01arz3ndektsv4rrffq69g5fav") as Id<"property">;
const programId = "prg_01arz3ndektsv4rrffq69g5fav";
const submissionId = "sub-2026-10-31-a";

const job = (overrides: Partial<BulkJob> = {}): BulkJob => ({
  organizationId: orgId,
  submissionId,
  propertyId,
  contentHash: "hash-a",
  state: "queued",
  rows: [
    {
      row: 1,
      programId,
      destination: "https://shop.example.com/a",
      status: "pending",
      linkId: null,
      code: null,
      reason: null,
    },
    {
      row: 2,
      programId: null,
      destination: "x",
      status: "rejected",
      linkId: null,
      code: "VALIDATION_FAILED",
      reason: "invalid_program_id",
    },
  ],
  ...overrides,
});

const LEASE_MS = 5 * 60 * 1000;
const t0 = new Date("2026-10-31T10:00:00.000Z");
const claimAt = (owner: string, now: Date) => ({ owner, now, expiresAt: new Date(now.getTime() + LEASE_MS) });

describeWithDatabase("bulk job store (DM-029, TP-W5-017, WP-5.3)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `bulk_jobs_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  test("a created job reads back with its rows in order", async () => {
    const store = createBulkJobStore(db);
    expect(await store.create(job())).toBe(true);
    expect(await store.find(orgId, submissionId)).toEqual(job());
  });

  test("a second create of the same submission writes nothing and keeps the first job (TP-W5-017)", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    expect(await store.create(job({ contentHash: "hash-b", rows: [] }))).toBe(false);
    const stored = await store.find(orgId, submissionId);
    expect(stored?.contentHash).toBe("hash-a");
    expect(stored?.rows).toHaveLength(2);
  });

  test("a job is not visible to another organization", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    expect(await store.find(otherOrgId, submissionId)).toBeNull();
  });

  test("a pending row is claimed once, a live claim is not taken over, and a lapsed claim can be", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    expect(await store.claimRow(orgId, submissionId, 1, claimAt("run-a", t0))).toBe(true);
    expect(await store.claimRow(orgId, submissionId, 1, claimAt("run-b", t0))).toBe(false);
    const later = new Date(t0.getTime() + LEASE_MS + 1);
    expect(await store.claimRow(orgId, submissionId, 1, claimAt("run-b", later))).toBe(true);
    expect(await store.claimRow(orgId, submissionId, 2, claimAt("run-b", later))).toBe(false);
  });

  test("a run that lost its row to a lapsed claim cannot save it, and the holder can", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    const created: BulkJobRow = {
      row: 1,
      programId,
      destination: "https://shop.example.com/a",
      status: "created",
      linkId: "lnk_x",
      code: null,
      reason: null,
    };
    const later = new Date(t0.getTime() + LEASE_MS + 1);
    await store.claimRow(orgId, submissionId, 1, claimAt("run-a", t0));
    await store.claimRow(orgId, submissionId, 1, claimAt("run-b", later));
    expect(await store.saveRow(orgId, submissionId, created, "run-a")).toBe(false);
    expect(await store.saveRow(orgId, submissionId, created, "run-b")).toBe(true);
    const stored = await store.find(orgId, submissionId);
    expect(stored?.rows[0]).toEqual({ ...created, programId });
  });

  test("a final row is not replaced by a later save", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    const rejected: BulkJobRow = {
      row: 2,
      programId: null,
      destination: "x",
      status: "rejected",
      linkId: null,
      code: "STATE_CONFLICT",
      reason: "property_not_approved",
    };
    expect(await store.saveRow(orgId, submissionId, { ...rejected, status: "created", linkId: "lnk_y" }, "run-a")).toBe(
      false,
    );
    const stored = await store.find(orgId, submissionId);
    expect(stored?.rows[1]).toEqual(job().rows[1]);
  });

  test("a saved row is final: saving it again leaves one row", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    const created: BulkJobRow = {
      row: 1,
      programId,
      destination: "https://shop.example.com/a",
      status: "created",
      linkId: "lnk_x",
      code: null,
      reason: null,
    };
    await store.claimRow(orgId, submissionId, 1, claimAt("run-a", t0));
    expect(await store.saveRow(orgId, submissionId, created, "run-a")).toBe(true);
    expect(await store.saveRow(orgId, submissionId, created, "run-a")).toBe(false);
    await store.setState(orgId, submissionId, "completed");
    const stored = await store.find(orgId, submissionId);
    expect(stored?.state).toBe("completed");
    expect(stored?.rows.map((row) => [row.row, row.status, row.linkId])).toEqual([
      [1, "created", "lnk_x"],
      [2, "rejected", null],
    ]);
  });
});
