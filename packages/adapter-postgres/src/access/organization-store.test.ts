import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createOrganizationStore } from "./organization-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const creatorId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const now = new Date("2026-01-01T00:00:00.000Z");

describeWithDatabase("organization store (TP-W2-027)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `org_store_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await sql
      .raw(`create schema "${schema}"`)
      .execute(new Kysely<unknown>({ dialect: new PostgresDialect({ pool: setup }) }));
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into "user" (id, name, email, "emailVerified") values (${creatorId}, 'Creator', 'creator@example.com', false)`.execute(
      db,
    );
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await sql
      .raw(`drop schema if exists "${schema}" cascade`)
      .execute(new Kysely<unknown>({ dialect: new PostgresDialect({ pool: cleanup }) }));
    await cleanup.end();
  });

  const record = {
    id: orgId,
    name: "Acme Media",
    country: "ES",
    baseCurrency: "EUR",
    status: "active" as const,
    createdBy: creatorId,
    createdAt: now,
    updatedAt: now,
  };

  test("writes the organization and its owner membership together", async () => {
    const store = createOrganizationStore(db);
    await store.createWithOwner({
      organization: record,
      ownerMembership: { organizationId: orgId, userId: creatorId, role: "owner" },
    });

    const orgs = await sql<{ id: string }>`select id from organizations`.execute(db);
    const members = await sql<{ user_id: string; role: string }>`select user_id, role from memberships`.execute(db);
    expect(orgs.rows).toEqual([{ id: orgId }]);
    expect(members.rows).toEqual([{ user_id: creatorId, role: "owner" }]);
  });

  test("a failed membership insert rolls back the organization insert", async () => {
    const store = createOrganizationStore(db);
    const missingUser = "usr_01bx5zzkbkactav9wevgemmvrz" as Id<"user">;

    // The membership names a user that does not exist, so its foreign key fails after the organization insert.
    await expect(
      store.createWithOwner({
        organization: record,
        ownerMembership: { organizationId: orgId, userId: missingUser, role: "owner" },
      }),
    ).rejects.toThrow();

    const orgs = await sql<{ id: string }>`select id from organizations`.execute(db);
    expect(orgs.rows).toEqual([]);
  });
});
