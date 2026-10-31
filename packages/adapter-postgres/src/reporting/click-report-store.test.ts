import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createClickReportStore } from "./click-report-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const orgB = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const from = new Date("2026-10-01T00:00:00.000Z");
const to = new Date("2026-11-01T00:00:00.000Z");

describeWithDatabase("click report store (TP-W5-036, WP-5.9)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `click_report_${crypto.randomUUID().replaceAll("-", "")}`;
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

  // Links and clicks are seeded with foreign-key checks off. The tests are about the query's tenant and window filters,
  // not about the parent rows, which the links and properties migrations already constrain.
  async function seedLink(id: string, organizationId: Id<"organization">): Promise<void> {
    await db.transaction().execute(async (tx) => {
      await sql`set local session_replication_role = replica`.execute(tx);
      await sql`insert into links (id, organization_id, publisher_id, property_id, program_id, slug, destination_url,
          status, version, created_at, updated_at)
        values (${id}, ${organizationId}, 'pub_x', 'prp_x', 'prg_x', ${id}, 'https://shop.example.com/x', 'active', 1,
          now(), now())`.execute(tx);
    });
  }

  async function seedClick(key: string, linkId: string, occurredAt: Date, recordedAt = occurredAt): Promise<void> {
    await sql`insert into clicks (dedup_key, link_id, occurred_at, recorded_at)
      values (${key}, ${linkId}, ${occurredAt}, ${recordedAt})`.execute(db);
  }

  test("counts clicks per link inside the half-open window, for one organization only", async () => {
    await seedLink("lnk_a", orgA);
    await seedLink("lnk_b", orgA);
    await seedLink("lnk_foreign", orgB);
    await seedLink("lnk_idle", orgA);

    await seedClick("c1", "lnk_a", from); // included: the window starts at from
    await seedClick("c2", "lnk_a", new Date("2026-10-15T09:00:00.000Z"));
    await seedClick("c3", "lnk_a", to); // excluded: the window ends before to
    await seedClick("c4", "lnk_b", new Date("2026-10-20T09:00:00.000Z"));
    await seedClick("c5", "lnk_foreign", new Date("2026-10-20T09:00:00.000Z"));
    await seedClick("c6", "lnk_a", new Date("2026-09-30T23:59:59.000Z")); // before the window

    const store = createClickReportStore(db);
    const rows = await store.countByLink({ organizationId: orgA, from, to, afterLinkId: null, limit: 10 });

    expect(rows).toEqual([
      { linkId: "lnk_a", clicks: 2 },
      { linkId: "lnk_b", clicks: 1 },
    ]);
  });

  test("pages in link ID order: the cursor resumes after the last link and the limit caps the page", async () => {
    for (const id of ["lnk_a", "lnk_b", "lnk_c"]) {
      await seedLink(id, orgA);
      await seedClick(`${id}-1`, id, new Date("2026-10-10T00:00:00.000Z"));
    }
    const store = createClickReportStore(db);

    const first = await store.countByLink({ organizationId: orgA, from, to, afterLinkId: null, limit: 2 });
    expect(first.map((row) => row.linkId)).toEqual(["lnk_a", "lnk_b"]);

    const second = await store.countByLink({ organizationId: orgA, from, to, afterLinkId: "lnk_b", limit: 2 });
    expect(second.map((row) => row.linkId)).toEqual(["lnk_c"]);
  });

  test("latestRecordedAt ignores clicks recorded before the lookback, and reads only the organization's links", async () => {
    await seedLink("lnk_old", orgA);
    await seedClick("c0", "lnk_old", new Date("2025-01-01T00:00:00.000Z"), new Date("2025-01-01T00:00:00.000Z"));
    const store = createClickReportStore(db);
    expect(await store.latestRecordedAt(orgA, new Date("2026-01-01T00:00:00.000Z"))).toBeNull();
  });

  test("latestRecordedAt reads the newest recorded click of the organization's links, or null", async () => {
    await seedLink("lnk_a", orgA);
    await seedLink("lnk_foreign", orgB);
    const newest = new Date("2026-10-25T12:00:00.000Z");
    await seedClick("c1", "lnk_a", new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-01T00:00:01.000Z"));
    await seedClick("c2", "lnk_a", newest, newest);
    await seedClick("c3", "lnk_foreign", new Date("2026-10-31T00:00:00.000Z"), new Date("2026-10-31T00:00:00.000Z"));

    const store = createClickReportStore(db);
    const since = new Date("2026-01-01T00:00:00.000Z");
    expect(await store.latestRecordedAt(orgA, since)).toEqual(newest);
    expect(await store.latestRecordedAt(orgB, since)).toEqual(new Date("2026-10-31T00:00:00.000Z"));
    expect(await store.latestRecordedAt("org_01crz3ndektsv4rrffq69g5fav" as Id<"organization">, since)).toBeNull();
  });
});
