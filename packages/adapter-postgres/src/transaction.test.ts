import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { withTx } from "./transaction";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("withTx", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let table: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    table = `transaction_test_${crypto.randomUUID().replaceAll("-", "")}`;
    await sql.raw(`create table "${table}" (id integer primary key)`).execute(db);
  });

  afterEach(async () => {
    await sql.raw(`drop table if exists "${table}"`).execute(db);
    await db.destroy();
  });

  test("commits a successful callback and returns its result", async () => {
    const result = await withTx(db, async (tx) => {
      await sql.raw(`insert into "${table}" (id) values (1)`).execute(tx);
      return "committed";
    });
    expect(result).toBe("committed");
    const rows = await sql<{ id: number }>`select id from ${sql.table(table)}`.execute(db);
    expect(rows.rows).toEqual([{ id: 1 }]);
  });

  test("rolls back a write when the callback throws", async () => {
    const failure = new Error("stop");
    await expect(
      withTx(db, async (tx) => {
        await sql.raw(`insert into "${table}" (id) values (1)`).execute(tx);
        throw failure;
      }),
    ).rejects.toBe(failure);
    const rows = await sql<{ id: number }>`select id from ${sql.table(table)}`.execute(db);
    expect(rows.rows).toEqual([]);
  });

  test("rejects a nested transaction with a clear error", async () => {
    await withTx(db, async (tx) => {
      await expect(withTx(tx, async () => undefined)).rejects.toThrow("nested transactions are not supported");
    });
  });
});
