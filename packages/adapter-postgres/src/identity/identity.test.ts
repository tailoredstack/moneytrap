import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getUserProfile, type IdentityDatabase } from "@moneytrap/app/src/queries/identity/user-profile";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { migrationProvider } from "../migrations";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const otherUserId = "usr_01arz3ndektsv4rrffq69g5faw" as Id<"user">;
const now = new Date("2026-01-01T00:00:00.000Z");
const queryCtx = (db: Kysely<unknown>) => ({ db: db as unknown as Kysely<IdentityDatabase> });

test("0003_identity is indexed after 0002_better_auth", async () => {
  const names = Object.keys(await migrationProvider.getMigrations());
  expect(names).toContain("0003_identity");
  expect(names.indexOf("0003_identity")).toBeGreaterThan(names.indexOf("0002_better_auth"));
});

describeWithDatabase("identity schema and queries (DM-001, WP-2.12)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `identity_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into "user" (id, name, email, "emailVerified") values (${userId}, 'Ada', 'ada@example.com', true)`.execute(
      db,
    );
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  async function insertProfile(id: string, status = "pending") {
    await sql`insert into user_profiles (user_id, status, auth_version, locale, created_at, updated_at)
      values (${id}, ${status}, 0, 'en-GB', ${now}, ${now})`.execute(db);
  }

  test("a profile must reference an existing Better Auth user (foreign key to user.id)", async () => {
    await expect(insertProfile(otherUserId)).rejects.toThrow(/foreign key/i);
  });

  test("a user has at most one profile (primary key on user_id)", async () => {
    await insertProfile(userId);
    await expect(insertProfile(userId)).rejects.toThrow(/duplicate key|unique/i);
  });

  test("status is limited to the DM-001 states", async () => {
    await expect(insertProfile(userId, "deleted")).rejects.toThrow(/check/i);
    await insertProfile(userId, "active");
  });

  test("deleting the Better Auth user removes its profile", async () => {
    await insertProfile(userId, "active");
    await sql`delete from "user" where id = ${userId}`.execute(db);
    const { rows } = await pool.query("select 1 from user_profiles where user_id = $1", [userId]);
    expect(rows).toEqual([]);
  });

  test("getUserProfile returns a DTO with camelCase fields and no secrets", async () => {
    await insertProfile(userId, "active");
    const profile = await getUserProfile(queryCtx(db), userId);
    expect(profile).toEqual({
      id: userId,
      email: "ada@example.com",
      status: "active",
      authVersion: 0,
      locale: "en-GB",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
    expect(profile).not.toHaveProperty("password");
  });

  test("getUserProfile returns null for a user without a profile", async () => {
    expect(await getUserProfile(queryCtx(db), userId)).toBeNull();
  });
});
