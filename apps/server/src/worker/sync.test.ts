import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCatalogSyncStore, migrate } from "@moneytrap/adapter-postgres";
import { FakeCatalogSyncStore, FakeClock, FakeIdGenerator, RecordedNetworkSimulator } from "@moneytrap/test-kit";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { runCatalogSync } from "./sync";

const NETWORK = "net_worker";
const clock = () => new FakeClock("2026-10-01T06:00:00.000Z");

describe("catalog sync worker (TP-W4-004)", () => {
  test("a temporarily_unavailable page is retried after the upstream's retry-after, then resumes", async () => {
    const waits: number[] = [];
    const upstream = new RecordedNetworkSimulator("sync-interrupt");
    const result = await runCatalogSync(
      {
        connector: upstream,
        store: new FakeCatalogSyncStore(),
        clock: clock(),
        ids: new FakeIdGenerator(),
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
      NETWORK,
    );

    expect(result.ok).toBe(true);
    expect(waits).toEqual([30_000]);
  });

  test("a disabled credential is not retried", async () => {
    const waits: number[] = [];
    const result = await runCatalogSync(
      {
        connector: new RecordedNetworkSimulator("disabled-credential"),
        store: new FakeCatalogSyncStore(),
        clock: clock(),
        ids: new FakeIdGenerator(),
        sleep: async (ms) => {
          waits.push(ms);
        },
      },
      NETWORK,
    );

    expect(result).toEqual({ ok: false, failure: { state: "not_authorized" } });
    expect(waits).toEqual([]);
  });
});

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("catalog sync worker against Postgres (CT-015)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    schema = `worker_sync_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    // network_advertisers references networks (WP-4.4), so the test network must exist first.
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values (${NETWORK}, ${NETWORK}, ${NETWORK}, now(), now())`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  test("a malformed program is quarantined, never stored as a program, and the rest of the catalog syncs", async () => {
    const result = await runCatalogSync(
      {
        connector: new RecordedNetworkSimulator("malformed-records"),
        store: createCatalogSyncStore(db),
        clock: clock(),
        ids: new FakeIdGenerator(),
      },
      NETWORK,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.programs.quarantined).toBe(1);
    const programs = await sql<{ n: string }>`select count(*)::text as n from programs`.execute(db);
    expect(programs.rows[0]?.n).toBe("2");
    const held = await sql<{ n: string }>`select count(*)::text as n from catalog_quarantine`.execute(db);
    expect(held.rows[0]?.n).toBe("1");
  });
});
