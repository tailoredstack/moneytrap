import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeStatement } from "@moneytrap/app/src/finance/statements";
import type { StatementRecord } from "@moneytrap/app/src/ports/statement-store";
import { createShareRule, type Id } from "@moneytrap/domain";
import { FakePublisherBalanceSource, FakeStatementStore, fixtureCtx } from "@moneytrap/test-kit";
import { runStatementStoreContract } from "@moneytrap/test-kit/src/contracts/statement-store";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createStatementStore } from "./statement-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

runStatementStoreContract([
  {
    name: "fake",
    async open() {
      const store = new FakeStatementStore();
      return {
        store,
        seed: async (record) => {
          await store.recordClosed(record);
        },
        close: async () => {},
      };
    },
  },
]);

let pool: Pool, db: Kysely<unknown>, schema: string;
describeWithDatabase("statement Postgres store contract (TP-W6-048)", () => {
  beforeEach(async () => {
    schema = `statements_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();
    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ('usr_statements', 'Statements', 'statements@example.test', true, now(), now()) on conflict do nothing`.execute(
      db,
    );
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values ('org_statements', 'Statements', 'US', 'USD', 'active', 'usr_statements', now(), now()) on conflict do nothing`.execute(
      db,
    );
  });
  afterEach(async () => {
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });
  test("persists and reloads, refuses overwriting a closed period, and scopes publisher reads", async () => {
    const publisherId = `pub_${crypto.randomUUID()}`;
    await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at) values (${publisherId}, 'A', 'approved', 'org_statements', now(), now())`.execute(
      db,
    );
    const store = createStatementStore(db),
      first = makeRecord(publisherId, "first"),
      changed = makeRecord(publisherId, "changed");
    expect(await store.recordClosed(first)).toBe(true);
    const original = await store.findClosed(first.publisherId, first.currency, first.periodStart, first.periodEnd);
    expect(original).toEqual(first);
    expect(await store.recordClosed(changed)).toBe(false);
    expect(
      await store.recordClosed({ ...changed, id: `stm_${crypto.randomUUID()}` as StatementRecord["id"], revision: 2 }),
    ).toBe(false);
    await expect(
      store.recordClosed({ ...changed, id: first.id, periodStart: new Date("2026-10-02T00:00:00.000Z") }),
    ).rejects.toThrow();
    expect(await store.findClosed(first.publisherId, first.currency, first.periodStart, first.periodEnd)).toEqual(
      original,
    );
    expect(await store.list(first.publisherId)).toEqual([first]);
    expect(await store.list("pub_missing" as StatementRecord["publisherId"])).toEqual([]);
  });
  test("organization reads include every publisher but require matching membership and scope", async () => {
    const userA = `usr_${crypto.randomUUID()}`,
      userB = `usr_${crypto.randomUUID()}`;
    const orgA = `org_${crypto.randomUUID()}`,
      orgB = `org_${crypto.randomUUID()}`;
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values
      (${userA}, 'A', ${`${userA}@example.test`}, true, now(), now()), (${userB}, 'B', ${`${userB}@example.test`}, true, now(), now())`.execute(
      db,
    );
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at) values
      (${orgA}, 'A', 'US', 'USD', 'active', 'usr_statements', now(), now()), (${orgB}, 'B', 'US', 'USD', 'active', 'usr_statements', now(), now())`.execute(
      db,
    );
    await sql`insert into memberships (organization_id, user_id, role) values (${orgA}, ${userA}, 'owner'), (${orgB}, ${userB}, 'owner')`.execute(
      db,
    );
    const pubA1 = `pub_${crypto.randomUUID()}`,
      pubA2 = `pub_${crypto.randomUUID()}`,
      pubB = `pub_${crypto.randomUUID()}`;
    await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at) values
      (${pubA1}, 'A1', 'approved', ${orgA}, now(), now()), (${pubA2}, 'A2', 'approved', ${orgA}, now(), now()), (${pubB}, 'B', 'approved', ${orgB}, now(), now())`.execute(
      db,
    );
    const store = createStatementStore(db);
    const a1 = makeRecord(pubA1, "11"),
      a2 = makeRecord(pubA2, "22"),
      b = makeRecord(pubB, "33");
    await store.recordClosed(a1);
    await store.recordClosed(a2);
    await store.recordClosed(b);
    expect((await store.listForOrganization(userA as never, orgA as never)).map((row) => row.id).sort()).toEqual(
      [a1.id, a2.id].sort(),
    );
    expect(await store.listForOrganization(userA as never, orgB as never)).toEqual([]);
    expect(await store.listForOrganization("usr_nonmember" as never, orgA as never)).toEqual([]);
    expect(await store.findForOrganization(userA as never, orgA as never, a2.id)).toEqual(a2);
    expect(await store.findForOrganization(userA as never, orgA as never, b.id)).toBeNull();
    expect(await store.findForOrganization(userB as never, orgB as never, b.id)).toEqual(b);
  });
  test("regenerating a closed period after source changes leaves the Postgres record immutable (TP-W6-048)", async () => {
    const publisherId = `pub_${crypto.randomUUID()}` as Id<"publisher">;
    await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at) values (${publisherId}, 'Regen', 'approved', 'org_statements', now(), now())`.execute(
      db,
    );
    const store = createStatementStore(db),
      source = new FakePublisherBalanceSource();
    const rule = createShareRule(7000, 3000, 0, 1);
    source.add(publisherId, {
      conversionId: "cnv_one" as Id<"conversion">,
      currency: "USD",
      state: "approved",
      recognizedMinor: 10_000n,
      shareRule: rule,
      clearedAt: null,
    });
    const ctx = fixtureCtx<Record<string, never>>(undefined as never, {
      ids: { next: () => `stm_${crypto.randomUUID()}` } as never,
    });
    const period = {
      publisherId,
      currency: "USD" as const,
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-11-01T00:00:00Z"),
    };
    const first = await closeStatement(ctx, { source, store }, period);
    if (!first.ok) throw new Error("initial close failed");
    const persisted = await store.findClosed(publisherId, "USD", period.periodStart, period.periodEnd);
    if (!persisted) throw new Error("statement did not persist");
    source.add(publisherId, {
      conversionId: "cnv_two" as Id<"conversion">,
      currency: "USD",
      state: "approved",
      recognizedMinor: 500_000n,
      shareRule: rule,
      clearedAt: null,
    });
    const again = await closeStatement(ctx, { source, store }, period);
    expect(again).toEqual({ ok: true, value: { record: persisted, created: false } });
    expect(await store.findClosed(publisherId, "USD", period.periodStart, period.periodEnd)).toEqual(persisted);
  });
});

function makeRecord(publisherId: string, amount: string): StatementRecord {
  const start = new Date("2026-10-01T00:00:00.000Z"),
    end = new Date("2026-11-01T00:00:00.000Z");
  const content = {
    publisherId: publisherId as StatementRecord["publisherId"],
    currency: "USD" as const,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    asOf: end.toISOString(),
    totals: { estimatedMinor: amount, approvedMinor: amount, availableMinor: amount },
    lines: [],
  };
  return {
    id: `stm_${publisherId}` as StatementRecord["id"],
    publisherId: publisherId as StatementRecord["publisherId"],
    currency: "USD",
    periodStart: start,
    periodEnd: end,
    revision: 1,
    contentHash: "a".repeat(64),
    objectRef: `statements/${publisherId}.json`,
    content,
    createdAt: end,
  };
}
