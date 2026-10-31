import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { appendOutboxEvent, migrate, withTx } from "@moneytrap/adapter-postgres";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { createRelay } from "./relay";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase("relay worker", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;

  beforeEach(async () => {
    schema = `relay_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
  });

  afterEach(async () => {
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema "${schema}" cascade`);
    await admin.end();
  });

  test("step publishes committed events and reports how many it sent", async () => {
    await withTx(db, async (tx) => {
      await appendOutboxEvent(tx, {
        id: "evt_1",
        topic: "link.created",
        aggregateId: "link_1",
        aggregateVersion: 1,
        payload: {},
      });
    });
    const sent: string[] = [];
    const relay = createRelay({
      db,
      publish: async (event) => {
        sent.push(event.id);
      },
    });
    expect(await relay.step()).toBe(1);
    expect(await relay.step()).toBe(0);
    expect(sent).toEqual(["evt_1"]);
    const rows = await sql<{ published_at: Date | null }>`select published_at from outbox_events`.execute(db);
    expect(rows.rows[0]?.published_at).not.toBeNull();
  });

  test("start keeps polling until stop, and stop resolves", async () => {
    const sent: string[] = [];
    const relay = createRelay({
      db,
      idleMs: 5,
      publish: async (event) => {
        sent.push(event.id);
      },
    });
    relay.start();
    await withTx(db, async (tx) => {
      await appendOutboxEvent(tx, {
        id: "evt_2",
        topic: "link.created",
        aggregateId: "link_1",
        aggregateVersion: 1,
        payload: {},
      });
    });
    for (let i = 0; i < 100 && sent.length === 0; i++) await Bun.sleep(5);
    await relay.stop();
    expect(sent).toEqual(["evt_2"]);
  });
});
