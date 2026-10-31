import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createPropertyStore } from "./property-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const userId = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const propertyId = "prp_01arz3ndektsv4rrffq69g5fav" as Id<"property">;
const challengeId = "vrf_01arz3ndektsv4rrffq69g5fav" as Id<"verification">;
const now = new Date("2026-03-01T12:00:00.000Z");
const expiresAt = new Date("2026-03-02T12:00:00.000Z");

describeWithDatabase("property store (TP-W3-013)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `prop_store_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await sql
      .raw(`create schema "${schema}"`)
      .execute(new Kysely<unknown>({ dialect: new PostgresDialect({ pool: setup }) }));
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Owner', 'owner@example.com', true, ${now}, ${now})`.execute(db);
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values (${orgId}, 'Org', 'GB', 'GBP', 'active', ${userId}, ${now}, ${now})`.execute(db);
    await sql`insert into properties (id, organization_id, publisher_id, type, canonical_identifier, normalized_identifier,
        status, version, created_at, updated_at)
      values (${propertyId}, ${orgId}, ${publisherId}, 'website', 'Example.com', 'example.com',
        'verification_pending', 2, ${now}, ${now})`.execute(db);
    await sql`insert into property_verifications (id, property_id, method, challenge_hash, expires_at, attempts, created_at)
      values (${challengeId}, ${propertyId}, 'dns', 'digest:1', ${expiresAt}, 0, ${now})`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await sql
      .raw(`drop schema if exists "${schema}" cascade`)
      .execute(new Kysely<unknown>({ dialect: new PostgresDialect({ pool: cleanup }) }));
    await cleanup.end();
  });

  const event = {
    id: "evt_01arz3ndektsv4rrffq69g5fav" as Id<"event">,
    topic: "property.verified" as const,
    aggregateId: propertyId,
    aggregateVersion: 3,
    payload: { propertyId },
  };
  const audit = {
    id: "evt_01bx5zzkbkactav9wevgemmvrz" as Id<"event">,
    organizationId: orgId,
    actor: { type: "user", id: userId },
    action: "property.verified",
    entityType: "property" as const,
    entityId: propertyId,
    metadata: { method: "dns" },
    occurredAt: now,
  };
  const property = {
    id: propertyId,
    organizationId: orgId,
    publisherId,
    type: "website" as const,
    canonicalIdentifier: "Example.com",
    normalizedIdentifier: "example.com",
    status: "verification_pending" as const,
    version: 2,
  };

  test("find is scoped to the organization", async () => {
    const store = createPropertyStore(db);
    expect((await store.find({ organizationId: orgId }, propertyId))?.status).toBe("verification_pending");
    expect(
      await store.find({ organizationId: "org_01bx5zzkbkactav9wevgemmvrz" as Id<"organization"> }, propertyId),
    ).toBe(null);
  });

  test("TP-W3-013 a stale version writes nothing and returns false", async () => {
    const store = createPropertyStore(db);
    const stale = { ...property, version: 1 };
    const wrote = await store.completeVerification({
      property: stale,
      nextStatus: "verified",
      challengeId,
      verifiedAt: now,
      audit,
      event,
    });
    expect(wrote).toBe(false);
    expect((await store.find({ organizationId: orgId }, propertyId))?.status).toBe("verification_pending");
    const events = await sql<{ n: string }>`select count(*)::text as n from outbox_events`.execute(db);
    expect(events.rows[0]?.n).toBe("0");
  });

  test("TP-W3-013 two verifies with the same version: one wins, one event, one audit row", async () => {
    const store = createPropertyStore(db);
    const write = {
      property,
      nextStatus: "verified" as const,
      challengeId,
      verifiedAt: now,
      audit,
      event,
    };
    const results = await Promise.all([store.completeVerification(write), store.completeVerification(write)]);

    expect(results.filter(Boolean)).toHaveLength(1);
    const events = await sql<{ n: string }>`select count(*)::text as n from outbox_events`.execute(db);
    expect(events.rows[0]?.n).toBe("1");
    const audits = await sql<{ n: string }>`select count(*)::text as n from audit_logs`.execute(db);
    expect(audits.rows[0]?.n).toBe("1");
    const row = await sql<{ status: string; version: number }>`select status, version from properties`.execute(db);
    expect(row.rows[0]).toEqual({ status: "verified", version: 3 });
  });

  test("TP-W3-013 the latest challenge is the last issued, even with equal timestamps and a lower ID", async () => {
    const store = createPropertyStore(db);
    // The later challenge has the lower ID and the same created_at, so only issuance order can pick it.
    await sql`insert into property_verifications (id, property_id, method, challenge_hash, expires_at, attempts, created_at)
      values ('vrf_00000000000000000000000000', ${propertyId}, 'dns', 'digest:2', ${expiresAt}, 0, ${now})`.execute(db);
    expect((await store.latestChallenge(propertyId))?.challengeHash).toBe("digest:2");
  });

  test("recordAttempt increments the attempt count on the challenge", async () => {
    const store = createPropertyStore(db);
    await store.recordAttempt(challengeId);
    await store.recordAttempt(challengeId);
    const row = await sql<{ attempts: number }>`select attempts from property_verifications`.execute(db);
    expect(row.rows[0]?.attempts).toBe(2);
  });
});
