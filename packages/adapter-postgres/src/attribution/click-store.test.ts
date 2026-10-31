import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { recordClick } from "@moneytrap/app/src/attribution/record-click";
import type { ClickObservation } from "@moneytrap/app/src/ports/click-store";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { consumeOnce } from "../outbox/inbox";
import { createClickStore } from "./click-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const linkId = "lnk_01arz3ndektsv4rrffq69g5fav";
const occurredAt = new Date("2026-03-01T10:00:00.000Z");
const click = (dedupKey: string, at = occurredAt): ClickObservation => ({ dedupKey, linkId, occurredAt: at });

describeWithDatabase("click store (TP-W5-032 to TP-W5-035, DM-030, WP-5.8)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `click_store_${crypto.randomUUID().replaceAll("-", "")}`;
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

  const rows = async () =>
    (
      await sql<{ dedup_key: string; link_id: string; occurred_at: Date }>`
      select dedup_key, link_id, occurred_at from clicks order by dedup_key
    `.execute(db)
    ).rows;

  test("one click leaves one row with the link and time it was observed", async () => {
    const store = createClickStore(db);
    expect(await recordClick(store, click("click:a"))).toBe("recorded");
    expect(await rows()).toEqual([{ dedup_key: "click:a", link_id: linkId, occurred_at: occurredAt }]);
  });

  test("the same dedup key emitted twice, or replayed, keeps one row (CT-013)", async () => {
    const store = createClickStore(db);
    await recordClick(store, click("click:a"));
    expect(await recordClick(store, click("click:a"))).toBe("duplicate");
    expect(await recordClick(store, click("click:a"))).toBe("duplicate");
    expect((await rows()).map((r) => r.dedup_key)).toEqual(["click:a"]);
  });

  test("two distinct legitimate clicks one second apart are both kept (TP-W5-034, CT-013)", async () => {
    const store = createClickStore(db);
    const later = new Date(occurredAt.getTime() + 1000);
    await recordClick(store, click("click:a", occurredAt));
    await recordClick(store, click("click:b", later));
    expect((await rows()).map((r) => r.dedup_key)).toEqual(["click:a", "click:b"]);
  });

  test("a consumer that crashes after the click write, then is redelivered, leaves one row (TP-W5-035, WP-1.7)", async () => {
    const store = (tx: Parameters<typeof createClickStore>[0]) => createClickStore(tx);
    const deliver = (crash: boolean) =>
      consumeOnce(db, "click-ingest", "evt_click_1", async (tx) => {
        await recordClick(store(tx), click("click:replayed"));
        if (crash) throw new Error("crash after click write");
      });

    // The crash rolls back the inbox row and the click together, so the redelivery is not skipped as processed.
    await expect(deliver(true)).rejects.toThrow("crash after click write");
    expect(await rows()).toEqual([]);

    expect(await deliver(false)).toBe(true);
    expect(await deliver(false)).toBe(false);
    expect((await rows()).map((r) => r.dedup_key)).toEqual(["click:replayed"]);
  });

  test("concurrent emits of one click write one row", async () => {
    const store = createClickStore(db);
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => recordClick(store, click("click:race"))));
    expect(outcomes.filter((o) => o === "recorded")).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });
});
