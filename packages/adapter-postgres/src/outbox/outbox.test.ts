import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { withTx } from "../transaction";
import { consumeOnce } from "./inbox";
import { type RelayedEvent, relayOutboxBatch } from "./relay";
import { appendOutboxEvent } from "./writer";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const event = (n: number, topic = "link.created"): Parameters<typeof appendOutboxEvent>[1] => ({
  id: `evt_${n}`,
  topic,
  aggregateId: "link_1",
  aggregateVersion: n,
  payload: { n },
});

describeWithDatabase("outbox", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;

  beforeEach(async () => {
    schema = `outbox_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`create table state (id integer primary key)`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema "${schema}" cascade`);
    await admin.end();
  });

  const publishedRows = async () =>
    (
      await sql<{
        id: string;
        published_at: Date | null;
      }>`select id, published_at from outbox_events order by created_at, id`.execute(db)
    ).rows;

  test("writer accepts only a transaction, never a plain database handle", () => {
    // Compile-time check: typecheck fails if the writer accepts a non-transactional handle.
    const rejectsPlainDb = (handle: Kysely<unknown>) =>
      // @ts-expect-error outbox rows must be written inside the state change's transaction
      appendOutboxEvent(handle, event(1));
    expect(typeof rejectsPlainDb).toBe("function");
  });

  test("writer commits the outbox row with the state change", async () => {
    await withTx(db, async (tx) => {
      await sql`insert into state (id) values (1)`.execute(tx);
      await appendOutboxEvent(tx, event(1));
    });
    const state = await sql`select id from state`.execute(db);
    expect(state.rows).toHaveLength(1);
    expect((await publishedRows()).map((r) => r.id)).toEqual(["evt_1"]);
  });

  test("a throw after the writer leaves neither the state nor the outbox row", async () => {
    await expect(
      withTx(db, async (tx) => {
        await sql`insert into state (id) values (1)`.execute(tx);
        await appendOutboxEvent(tx, event(1));
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await sql`select id from state`.execute(db)).rows).toEqual([]);
    expect(await publishedRows()).toEqual([]);
  });

  test("relay publishes pending events in insertion order and marks them published", async () => {
    await withTx(db, async (tx) => {
      await appendOutboxEvent(tx, event(1));
      await appendOutboxEvent(tx, event(2));
    });
    const delivered: string[] = [];
    const count = await relayOutboxBatch(db, async (e: RelayedEvent) => {
      delivered.push(e.id);
    });
    expect(count).toBe(2);
    expect(delivered).toEqual(["evt_1", "evt_2"]);
    expect((await publishedRows()).every((r) => r.published_at !== null)).toBe(true);
    expect(await relayOutboxBatch(db, async () => undefined)).toBe(0);
  });

  test("a crash after publish but before the mark redelivers the event (at-least-once)", async () => {
    await withTx(db, async (tx) => {
      await appendOutboxEvent(tx, event(1));
    });
    const seen: string[] = [];
    await expect(
      relayOutboxBatch(db, async (e) => {
        seen.push(e.id);
        throw new Error("crash before mark");
      }),
    ).rejects.toThrow("crash before mark");
    await relayOutboxBatch(db, async (e) => {
      seen.push(e.id);
    });
    expect(seen).toEqual(["evt_1", "evt_1"]);
  });

  test("two concurrent relays never publish the same event twice", async () => {
    await withTx(db, async (tx) => {
      for (let n = 1; n <= 20; n++) await appendOutboxEvent(tx, event(n));
    });
    const seen: string[] = [];
    const slowPublish = async (e: RelayedEvent) => {
      await Bun.sleep(5);
      seen.push(e.id);
    };
    await Promise.all([relayOutboxBatch(db, slowPublish, 5), relayOutboxBatch(db, slowPublish, 5)]);
    while ((await relayOutboxBatch(db, slowPublish, 5)) > 0) {
      // drain the remaining batches
    }
    expect(seen).toHaveLength(20);
    expect(new Set(seen).size).toBe(20);
  });

  test("consumer dedupes a redelivered event by event_id", async () => {
    const handled: string[] = [];
    const handle = async (_tx: unknown, id: string) => {
      handled.push(id);
    };
    expect(await consumeOnce(db, "usage-counter", "evt_1", (tx) => handle(tx, "evt_1"))).toBe(true);
    expect(await consumeOnce(db, "usage-counter", "evt_1", (tx) => handle(tx, "evt_1"))).toBe(false);
    expect(await consumeOnce(db, "other-consumer", "evt_1", (tx) => handle(tx, "evt_1"))).toBe(true);
    expect(handled).toEqual(["evt_1", "evt_1"]);
  });
});
