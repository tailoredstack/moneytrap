import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createCatalogSyncStore } from "./catalog-sync-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const networkId = "net_test_sync";
const NETWORK_ID = networkId;
const observedAt = new Date("2026-10-01T12:00:00.000Z");
const program = {
  name: "Acme Summer",
  terms: "30 day cookie",
  eligibility: null,
  countries: ["GB"],
  channels: ["web"],
  approval: "pending" as const,
};

describeWithDatabase("catalog sync store (WP-4.6, CT-015)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    schema = `catalog_sync_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    // network_advertisers references networks (WP-4.4), so the test network must exist first.
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values (${NETWORK_ID}, ${NETWORK_ID}, ${NETWORK_ID}, now(), now())`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  test("the cursor and watermark are kept per scope and survive a fresh store instance", async () => {
    const store = createCatalogSyncStore(db);
    const watermark = new Date("2026-10-01T00:00:00.000Z");
    await store.saveCursor(networkId, "advertisers", { cursor: "sim1.page-2", watermark: null });
    await store.saveCursor(networkId, "programs:adv-1", { cursor: null, watermark });

    const reopened = createCatalogSyncStore(db);
    expect(await reopened.loadCursor(networkId, "advertisers")).toEqual({ cursor: "sim1.page-2", watermark: null });
    expect(await reopened.loadCursor(networkId, "programs:adv-1")).toEqual({ cursor: null, watermark });
    expect(await reopened.loadCursor(networkId, "programs:adv-9")).toEqual({ cursor: null, watermark: null });
  });

  test("an advertiser unchanged on a second write creates no revision", async () => {
    const store = createCatalogSyncStore(db);
    const write = {
      id: "adv_01arz3ndektsv4rrffq69g5fav",
      networkId,
      sourceId: "adv-1",
      revision: "1",
      name: "A",
      observedAt,
    };
    expect(await store.upsertAdvertiser(write)).toBe("created");
    expect(await store.upsertAdvertiser({ ...write, id: "adv_01arz3ndektsv4rrffq69g5fb" })).toBe("unchanged");
  });

  test("a program whose advertiser was never stored is not written and reports null", async () => {
    const store = createCatalogSyncStore(db);
    const outcome = await store.upsertProgram({
      id: "prg_01arz3ndektsv4rrffq69g5fav",
      networkId,
      advertiserSourceId: "adv-missing",
      sourceId: "prg-1",
      revision: "1",
      payload: program,
      observedAt,
    });
    expect(outcome).toBeNull();
    expect((await sql<{ n: string }>`select count(*)::text as n from programs`.execute(db)).rows[0]?.n).toBe("0");
  });

  test("a replayed quarantine writes one held record and emits one alert", async () => {
    const store = createCatalogSyncStore(db);
    const held = {
      id: "qtn_replay",
      networkId,
      scope: "programs:adv-1" as const,
      sourceId: null,
      reason: "missing_identity" as const,
      payload: { name: "No Identity" },
      observedAt,
    };
    await store.quarantine(held);
    await store.quarantine(held);

    expect((await sql<{ n: string }>`select count(*)::text as n from catalog_quarantine`.execute(db)).rows[0]?.n).toBe(
      "1",
    );
    expect((await sql<{ n: string }>`select count(*)::text as n from outbox_events`.execute(db)).rows[0]?.n).toBe("1");
  });

  test("a payload with a NUL escape is held as text rather than rejected by jsonb", async () => {
    const store = createCatalogSyncStore(db);
    await store.quarantine({
      id: "qtn_nul",
      networkId,
      scope: "advertisers",
      sourceId: null,
      reason: "invalid_field",
      payload: { name: "bad\u0000name" },
      observedAt,
    });
    expect((await sql<{ n: string }>`select count(*)::text as n from catalog_quarantine`.execute(db)).rows[0]?.n).toBe(
      "1",
    );
  });

  test("quarantine keeps the held record and emits its alert in one transaction, outside the fact tables", async () => {
    const store = createCatalogSyncStore(db);
    await store.quarantine({
      id: "qtn_01arz3ndektsv4rrffq69g5fav",
      networkId,
      scope: "programs:adv-1",
      sourceId: null,
      reason: "missing_identity",
      payload: { name: "No Identity", approval: "approved" },
      observedAt,
    });

    const held = await sql<{
      reason: string;
      payload: Record<string, unknown>;
    }>`select reason, payload::jsonb as payload
      from catalog_quarantine where network_id = ${networkId}`.execute(db);
    expect(held.rows).toEqual([{ reason: "missing_identity", payload: { name: "No Identity", approval: "approved" } }]);

    const alerts = await sql<{ topic: string }>`select topic from outbox_events`.execute(db);
    expect(alerts.rows.map((row) => row.topic)).toEqual(["catalog.record_quarantined"]);
    expect((await sql<{ n: string }>`select count(*)::text as n from programs`.execute(db)).rows[0]?.n).toBe("0");
  });
});
