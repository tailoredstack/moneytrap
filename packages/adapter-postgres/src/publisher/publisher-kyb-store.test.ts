import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { KybSubmissionWrite } from "@moneytrap/app/src/ports/publisher-kyb-store";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createPublisherKybStore } from "./publisher-kyb-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const kybId = "kyb_01arz3ndektsv4rrffq69g5fav" as Id<"kyb">;
const reference = "vault:kyb/doc_0001";
const now = new Date("2026-01-01T00:00:00.000Z");

function submission(overrides: Partial<KybSubmissionWrite> = {}): KybSubmissionWrite {
  return {
    expectedStatus: "draft",
    publisher: { id: publisherId, legalName: "Acme Media", status: "in_review" },
    kyb: {
      id: kybId,
      publisherId,
      entityType: "company",
      companyReference: "CRN-12345678",
      providerRef: reference,
      state: "in_review",
      createdAt: now,
    },
    event: {
      id: `publisher.submitted:${kybId}`,
      topic: "publisher.submitted",
      aggregateId: publisherId,
      aggregateVersion: 1,
      payload: { publisherId, kybId, state: "in_review" },
    },
    ...overrides,
  };
}

describeWithDatabase("publisher KYB store (TP-W3-003, DM-010, WP-3.2)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `pub_kyb_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into publishers (id, legal_name, status, created_at, updated_at)
      values (${publisherId}, 'Acme Media', 'draft', ${now}, ${now})`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  test("stores the document reference and moves the publisher to in_review", async () => {
    const store = createPublisherKybStore(db);
    expect(await store.recordSubmission(submission())).toBe(true);

    const kyb = await sql<{ provider_ref: string; state: string; entity_type: string }>`
      select provider_ref, state, entity_type from publisher_kyb where id = ${kybId}`.execute(db);
    expect(kyb.rows).toEqual([{ provider_ref: reference, state: "in_review", entity_type: "company" }]);

    const publisher = await sql<{ status: string }>`select status from publishers where id = ${publisherId}`.execute(
      db,
    );
    expect(publisher.rows[0]?.status).toBe("in_review");
  });

  test("no table column can hold document bytes (no bytea, blob or content column)", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string }>`
      select table_name, column_name, data_type from information_schema.columns
      where table_schema = ${schema} and table_name in ('publishers', 'publisher_kyb')`.execute(db);

    expect(columns.rows.length).toBeGreaterThan(0);
    expect(columns.rows.filter((column) => column.data_type === "bytea")).toEqual([]);
    expect(columns.rows.filter((column) => /document|content|bytes|blob|file/i.test(column.column_name))).toEqual([]);
  });

  test("the publisher.submitted outbox event commits with the KYB row", async () => {
    const store = createPublisherKybStore(db);
    await store.recordSubmission(submission());

    const events = await sql<{ topic: string; aggregate_id: string; payload: unknown }>`
      select topic, aggregate_id, payload from outbox_events where topic = 'publisher.submitted'`.execute(db);
    expect(events.rows).toEqual([
      { topic: "publisher.submitted", aggregate_id: publisherId, payload: { publisherId, kybId, state: "in_review" } },
    ]);
  });

  test("a second submission for the same publisher writes nothing and reports false", async () => {
    const store = createPublisherKybStore(db);
    expect(await store.recordSubmission(submission())).toBe(true);

    const second = submission({
      kyb: {
        ...submission().kyb,
        id: "kyb_01bx5zzkbkactav9wevgemmvrz" as Id<"kyb">,
        providerRef: "vault:kyb/doc_0002",
      },
      event: { ...submission().event, id: "publisher.submitted:second", aggregateVersion: 2 },
    });
    expect(await store.recordSubmission(second)).toBe(false);

    const rows = await sql<{ count: string }>`select count(*)::text as count from publisher_kyb`.execute(db);
    expect(rows.rows[0]?.count).toBe("1");
  });

  test("a failing outbox write rolls back the status change and the KYB row", async () => {
    // A prior event at the same topic, aggregate and version makes the outbox insert fail.
    await sql`insert into outbox_events (id, topic, aggregate_id, aggregate_version, payload)
      values ('evt_seed', 'publisher.submitted', ${publisherId}, 1, '{}'::jsonb)`.execute(db);

    const store = createPublisherKybStore(db);
    await expect(store.recordSubmission(submission())).rejects.toThrow();

    const publisher = await sql<{ status: string }>`select status from publishers where id = ${publisherId}`.execute(
      db,
    );
    expect(publisher.rows[0]?.status).toBe("draft");
    const kyb = await sql<{ count: string }>`select count(*)::text as count from publisher_kyb`.execute(db);
    expect(kyb.rows[0]?.count).toBe("0");
  });

  test("findPublisher returns the domain shape, or null when the publisher is unknown", async () => {
    const store = createPublisherKybStore(db);
    expect(await store.findPublisher(publisherId)).toEqual({
      id: publisherId,
      legalName: "Acme Media",
      status: "draft",
    });
    expect(await store.findPublisher("pub_01bx5zzkbkactav9wevgemmvrz" as Id<"publisher">)).toBeNull();
  });
});
