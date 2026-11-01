import { describe, expect, test } from "bun:test";
import { importConversionBatch } from "@moneytrap/app/src/conversions/import-batch";
import { FakeClock } from "@moneytrap/test-kit/src/clock";
import { runConversionImportContract } from "@moneytrap/test-kit/src/contracts/conversion-import-store";
import { FakeIdGenerator } from "@moneytrap/test-kit/src/fakes/id-generator";
import { fixtureCtx } from "@moneytrap/test-kit/src/fixtures/ctx";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createConversionImportStore } from "./batches";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

// Each store gets a private schema with the migrations applied and one network, so the batch foreign key holds.
async function openPostgres() {
  const schema = `conversions_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema "${schema}"`);
  await admin.end();

  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  await migrate(db);
  await sql`insert into networks (id, code, name, created_at, updated_at)
    values ('net_one', 'one', 'Network one', now(), now())`.execute(db);

  return {
    store: createConversionImportStore(db),
    db,
    async close() {
      await db.destroy();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
      await cleanup.end();
    },
  };
}

if (databaseUrl) runConversionImportContract([{ name: "Postgres", open: openPostgres }]);

describeWithDatabase("conversion revisions in Postgres (TP-W6-016, CT-018)", () => {
  test("a changed row keeps the earlier revision and numbers the new one next", async () => {
    const fixture = await openPostgres();
    try {
      const ids = new FakeIdGenerator();
      const ctx = () =>
        fixtureCtx<Record<string, never>>(undefined as never, {
          clock: new FakeClock(new Date("2026-10-31T10:00:00.000Z")),
          ids,
        });
      const row = (amount: string) => ({
        externalRowRef: "tx-1",
        sourceRevision: "r1",
        amount,
        currency: "USD",
        status: "approved",
        occurredAt: "2026-10-01T12:00:00.000Z",
        subId: null,
      });
      const file = (digest: string, amount: string) => ({
        networkId: "net_one",
        resource: "transactions",
        sha256Digest: digest,
        objectRef: `objects/${digest.slice(0, 4)}`,
        parserVersion: "v1",
        sourceFrom: null,
        sourceTo: null,
        rows: [row(amount)],
      });

      await importConversionBatch(ctx(), fixture.store, file("a".repeat(64), "12.34"));
      await importConversionBatch(ctx(), fixture.store, file("b".repeat(64), "10.00"));

      const revisions = await sql<{ revision_seq: number; payload: { amountMinor: string } }>`
        select revision_seq, payload from conversion_source_revisions order by revision_seq`.execute(fixture.db);
      expect(revisions.rows.map((r) => [r.revision_seq, r.payload.amountMinor])).toEqual([
        [1, "1234"],
        [2, "1000"],
      ]);
    } finally {
      await fixture.close();
    }
  });
});
