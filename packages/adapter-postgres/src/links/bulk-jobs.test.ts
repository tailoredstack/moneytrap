import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BulkJob } from "@moneytrap/app/src/ports/bulk-job-store";
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

  test("a saved row replaces the pending result, and saving it again leaves one row", async () => {
    const store = createBulkJobStore(db);
    await store.create(job());
    const created = {
      row: 1,
      programId,
      destination: "https://shop.example.com/a",
      status: "created" as const,
      linkId: "lnk_x",
      code: null,
      reason: null,
    };
    await store.saveRow(orgId, submissionId, created);
    await store.saveRow(orgId, submissionId, created);
    await store.setState(orgId, submissionId, "completed");
    const stored = await store.find(orgId, submissionId);
    expect(stored?.state).toBe("completed");
    expect(stored?.rows.map((row) => [row.row, row.status, row.linkId])).toEqual([
      [1, "created", "lnk_x"],
      [2, "rejected", null],
    ]);
  });
});
