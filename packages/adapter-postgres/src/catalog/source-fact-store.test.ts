import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createSourceFactStore } from "./source-fact-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const networkId = "net_test_one";
const observedAt = new Date("2026-10-01T12:00:00.000Z");
const laterObservedAt = new Date("2026-10-02T12:00:00.000Z");

const program = {
  name: "Acme Summer",
  terms: "30 day cookie",
  eligibility: "Adults only",
  countries: ["GB", "IE"],
  channels: ["web"],
  approval: "approved" as const,
};

describeWithDatabase("source fact store (TP-W4-008, TP-W4-009)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `catalog_store_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  async function seedAdvertiser() {
    const store = createSourceFactStore(db);
    const result = await store.upsertNetworkAdvertiser({
      id: "nad_seed_one",
      networkId,
      sourceId: "adv-7",
      sourceRevision: "r1",
      payload: { name: "Acme Outdoors" },
      observedAt,
    });
    if (!result) throw new Error("seed advertiser was rejected");
    return result.id;
  }

  test("a new advertiser is created with one revision", async () => {
    const store = createSourceFactStore(db);
    const result = await store.upsertNetworkAdvertiser({
      id: "nad_one",
      networkId,
      sourceId: "adv-7",
      sourceRevision: "r1",
      payload: { name: "Acme Outdoors" },
      observedAt,
    });
    expect(result).toEqual({ id: "nad_one", outcome: "created" });
    const revisions = await store.listNetworkAdvertiserRevisions("nad_one");
    expect(revisions.map((revision) => revision.sourceRevision)).toEqual(["r1"]);
  });

  test("syncing the same payload twice creates no new revision (TP-W4-008)", async () => {
    const store = createSourceFactStore(db);
    const input = {
      id: "prg_one",
      networkAdvertiserId: await seedAdvertiser(),
      sourceId: "prg-42",
      sourceRevision: "r1",
      payload: program,
      observedAt,
    };
    const first = await store.upsertProgram(input);
    const second = await store.upsertProgram({ ...input, id: "prg_two", observedAt: laterObservedAt });

    expect(first?.outcome).toBe("created");
    expect(second).toEqual({ id: "prg_one", outcome: "unchanged" });
    expect(await store.listProgramRevisions("prg_one")).toHaveLength(1);
  });

  test("a changed commission keeps the previous revision and adds a new one (TP-W4-009)", async () => {
    const store = createSourceFactStore(db);
    const networkAdvertiserId = await seedAdvertiser();
    await store.upsertProgram({
      id: "prg_one",
      networkAdvertiserId,
      sourceId: "prg-42",
      sourceRevision: "r1",
      payload: program,
      observedAt,
    });

    const revised = await store.upsertProgram({
      id: "prg_unused",
      networkAdvertiserId,
      sourceId: "prg-42",
      sourceRevision: "r2",
      payload: { ...program, terms: "30 day cookie, 12% commission" },
      observedAt: laterObservedAt,
    });

    expect(revised).toEqual({ id: "prg_one", outcome: "revised" });
    const revisions = await store.listProgramRevisions("prg_one");
    expect(revisions.map((revision) => revision.revisionSeq)).toEqual([1, 2]);
    expect(revisions[0]?.payload.terms).toBe("30 day cookie");
    expect(revisions[1]?.payload.terms).toBe("30 day cookie, 12% commission");
    expect(revisions[1]?.sourceRevision).toBe("r2");
  });

  test("the same source ID under another network is a separate advertiser", async () => {
    const store = createSourceFactStore(db);
    const first = await store.upsertNetworkAdvertiser({
      id: "nad_a",
      networkId: "net_one",
      sourceId: "adv-7",
      sourceRevision: "r1",
      payload: { name: "Acme" },
      observedAt,
    });
    const second = await store.upsertNetworkAdvertiser({
      id: "nad_b",
      networkId: "net_two",
      sourceId: "adv-7",
      sourceRevision: "r1",
      payload: { name: "Acme" },
      observedAt,
    });
    expect(first?.id).toBe("nad_a");
    expect(second).toEqual({ id: "nad_b", outcome: "created" });
  });

  test("a blank source identity is rejected and writes nothing", async () => {
    const store = createSourceFactStore(db);
    const result = await store.upsertNetworkAdvertiser({
      id: "nad_blank",
      networkId,
      sourceId: " ",
      sourceRevision: "r1",
      payload: { name: "Nameless" },
      observedAt,
    });
    expect(result).toBeNull();
    const count = await sql<{ n: string }>`select count(*)::text as n from network_advertisers`.execute(db);
    expect(count.rows[0]?.n).toBe("0");
  });
});
