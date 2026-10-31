import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ReviewDecisionWrite } from "@moneytrap/app/src/ports/publisher-review-store";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createPublisherReviewStore } from "./publisher-review-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const userId = "usr_01arz3ndektsv4rrffq69g5fav";
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const auditId = "aud_01arz3ndektsv4rrffq69g5fav" as Id<"audit">;
const now = new Date("2026-10-31T10:20:00.000Z");

function decision(overrides: Partial<ReviewDecisionWrite> = {}): ReviewDecisionWrite {
  return {
    expectedStatus: "in_review",
    publisher: { id: publisherId, legalName: "Acme Media", status: "approved" },
    audit: {
      id: auditId,
      organizationId: orgId,
      actor: { type: "user", id: userId },
      action: "approve",
      entityType: "publisher",
      entityId: publisherId,
      metadata: { reason: "DNS ok" },
      occurredAt: now,
    },
    ...overrides,
  };
}

describeWithDatabase("publisher review store (TP-W3-006, WP-3.3)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `pub_review_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into "user" (id, name, email, "emailVerified") values (${userId}, 'Lee', 'lee@example.com', true)`.execute(
      db,
    );
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values (${orgId}, 'Acme', 'ES', 'EUR', 'active', ${userId}, ${now}, ${now})`.execute(db);
    await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at)
      values (${publisherId}, 'Acme Media', 'in_review', ${orgId}, ${now}, ${now})`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  const statusOf = async () =>
    (await sql<{ status: string }>`select status from publishers where id = ${publisherId}`.execute(db)).rows[0]
      ?.status;
  const auditRows = async () =>
    (await sql<{ action: string; metadata: { reason: string } }>`select action, metadata from audit_logs`.execute(db))
      .rows;

  test("moves the publisher to approved and writes the audit row with the reason", async () => {
    const store = createPublisherReviewStore(db);
    expect(await store.recordDecision(decision())).toBe(true);

    expect(await statusOf()).toBe("approved");
    expect(await auditRows()).toEqual([{ action: "approve", metadata: { reason: "DNS ok" } }]);
  });

  test("a failing audit insert rolls the status change back: the publisher stays in review", async () => {
    const store = createPublisherReviewStore(db);
    // A null entity_id breaks the audit insert after the status update has run in the same transaction.
    const broken = decision();
    broken.audit = { ...broken.audit, entityId: null as unknown as Id<"publisher"> };

    await expect(store.recordDecision(broken)).rejects.toThrow();
    expect(await statusOf()).toBe("in_review");
    expect(await auditRows()).toEqual([]);
  });

  test("a publisher that no longer holds the expected status is left alone and gets no audit row", async () => {
    await sql`update publishers set status = 'suspended' where id = ${publisherId}`.execute(db);
    const store = createPublisherReviewStore(db);

    expect(await store.recordDecision(decision())).toBe(false);
    expect(await statusOf()).toBe("suspended");
    expect(await auditRows()).toEqual([]);
  });

  test("a publisher without an organization is not found", async () => {
    await sql`update publishers set organization_id = null where id = ${publisherId}`.execute(db);
    expect(await createPublisherReviewStore(db).find(publisherId)).toBeNull();
  });
});
