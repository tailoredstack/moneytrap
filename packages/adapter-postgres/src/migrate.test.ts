import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";
import { Pool } from "pg";
import { migrate } from "./migrate";
import { migrationProvider } from "./migrations";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

test("static migration set is named NNNN_name and sorted", async () => {
  const names = Object.keys(await migrationProvider.getMigrations());
  for (const name of names) expect(name).toMatch(/^\d{4}_[a-z0-9_]+$/);
  expect(names).toEqual([...names].sort());
});

describeWithDatabase("migrate", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;

  beforeEach(async () => {
    schema = `migrate_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  });

  afterEach(async () => {
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });

  function recordingProvider(log: string[]): MigrationProvider {
    const step = (name: string): Migration => ({
      async up() {
        log.push(`up:${name}`);
      },
      async down() {
        log.push(`down:${name}`);
      },
    });
    // Deliberately inserted out of order; the runner must still apply by name.
    const migrations = { "0002_second": step("0002_second"), "0001_first": step("0001_first") };
    return {
      async getMigrations() {
        return migrations;
      },
    };
  }

  test("applies migrations in name order", async () => {
    const log: string[] = [];
    await migrate(db, recordingProvider(log));
    expect(log).toEqual(["up:0001_first", "up:0002_second"]);
  });

  test("re-running is a no-op", async () => {
    const log: string[] = [];
    const provider = recordingProvider(log);
    await migrate(db, provider);
    const second = await migrate(db, provider);
    expect(log).toEqual(["up:0001_first", "up:0002_second"]);
    expect(second.results ?? []).toEqual([]);
  });

  test("the default provider runs cleanly on an empty database, twice", async () => {
    await migrate(db);
    await migrate(db);
    // The static set is empty until WP-1.5, but Kysely still creates its bookkeeping table.
    const { rows } = await pool.query<{ exists: boolean }>(`select to_regclass($1) is not null as exists`, [
      `${schema}.kysely_migration`,
    ]);
    expect(rows[0]?.exists).toBe(true);
  });
});
