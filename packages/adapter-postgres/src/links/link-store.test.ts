import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { LinkAudit, LinkEvent, LinkRecord, LinkWritePrecondition } from "@moneytrap/app/src/ports/link-store";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool, type PoolClient } from "pg";
import { migrate } from "../migrate";
import { createLinkStore } from "./link-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const now = new Date("2026-11-01T10:00:00.000Z");
const userId = "usr_01arz3ndektsv4rrffq69g5fav";
const orgA = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const orgB = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const propertyId = "prp_01arz3ndektsv4rrffq69g5fav" as Id<"property">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const programId = "prg_01arz3ndektsv4rrffq69g5fav" as Id<"program">;
const linkId = "lnk_01arz3ndektsv4rrffq69g5fav" as Id<"link">;
const host = "shop.example.com";

const allowed: LinkWritePrecondition = { propertyId, programId, host };

function record(version = 1, status: LinkRecord["link"]["status"] = "draft"): LinkRecord {
  return {
    link: {
      id: linkId,
      publisherId,
      propertyId,
      slug: "spring",
      destinationUrl: `https://${host}/spring`,
      status,
      version,
    },
    organizationId: orgA,
    programId,
  };
}

function audit(id: string): LinkAudit {
  return {
    id: id as Id<"audit">,
    organizationId: orgA,
    actor: { type: "user", id: userId },
    action: "create",
    entityType: "link",
    entityId: linkId,
    metadata: {},
    occurredAt: now,
  };
}

function event(id: string, aggregateVersion: number): LinkEvent {
  return {
    id: id as Id<"event">,
    topic: "link.created",
    aggregateId: linkId,
    aggregateVersion,
    payload: { linkId },
  };
}

describeWithDatabase("link store (WP-5.13, DM-040)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `links_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);

    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Owner', 'owner@example.com', true, ${now}, ${now})`.execute(db);
    for (const org of [orgA, orgB]) {
      await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
        values (${org}, ${org}, 'GB', 'GBP', 'active', ${userId}, ${now}, ${now})`.execute(db);
    }
    await sql`insert into properties (id, organization_id, publisher_id, type, canonical_identifier, normalized_identifier,
        status, version, created_at, updated_at)
      values (${propertyId}, ${orgA}, ${publisherId}, 'website', 'shop.example.com', 'shop.example.com', 'approved', 1,
        ${now}, ${now})`.execute(db);
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values ('net_1', 'net_1', 'Net', ${now}, ${now})`.execute(db);
    await sql`insert into network_advertisers (id, network_id, external_id, created_at, updated_at)
      values ('adv_1', 'net_1', 'adv', ${now}, ${now})`.execute(db);
    await sql`insert into programs (id, network_advertiser_id, external_id, created_at, updated_at)
      values (${programId}, 'adv_1', 'prg', ${now}, ${now})`.execute(db);
    await sql`insert into program_revisions (program_id, revision_seq, source_revision, payload, observed_at, created_at)
      values (${programId}, 1, 'rev-1', ${JSON.stringify({ allowedHosts: [host] })}::jsonb, ${now}, ${now})`.execute(
      db,
    );
    await sql`insert into eligibility_decisions (id, organization_id, property_id, program_id, policy_version, decision,
        reasons, checks, inputs, input_hash, evaluated_at)
      values ('eld_1', ${orgA}, ${propertyId}, ${programId}, 1, 'allow', '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        'hash-1', ${now})`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  const linkRows = async () => (await sql<{ id: string }>`select id from links`.execute(db)).rows;
  const counts = async () =>
    (
      await sql<{ audits: number; events: number }>`select
        (select count(*)::int from audit_logs) as audits,
        (select count(*)::int from outbox_events) as events`.execute(db)
    ).rows[0];

  test("an inserted link reads back under its own organization", async () => {
    const store = createLinkStore(db);
    expect(
      await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: null }),
    ).toBe(true);

    expect(await store.find(orgA, linkId)).toEqual(record());
    expect(await counts()).toEqual({ audits: 1, events: 1 });
  });

  test("a lookup from another organization returns not-found", async () => {
    const store = createLinkStore(db);
    await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: null });

    expect(await store.find(orgB, linkId)).toBeNull();
  });

  test("an update from another organization writes nothing", async () => {
    const store = createLinkStore(db);
    await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: null });

    const moved = { ...record(2, "active"), organizationId: orgB };
    expect(
      await store.update({
        organizationId: orgB,
        expectedVersion: 1,
        record: moved,
        audit: audit("aud_2"),
        event: event("evt_2", 2),
        precondition: null,
      }),
    ).toBe(false);
    expect(await store.find(orgA, linkId)).toEqual(record());
    expect(await counts()).toEqual({ audits: 1, events: 1 });
  });

  test("an update at a stale version is refused and writes nothing", async () => {
    const store = createLinkStore(db);
    await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: null });

    expect(
      await store.update({
        organizationId: orgA,
        expectedVersion: 5,
        record: record(6, "active"),
        audit: audit("aud_2"),
        event: event("evt_2", 6),
        precondition: null,
      }),
    ).toBe(false);
    expect(await store.find(orgA, linkId)).toEqual(record());
  });

  test("a write whose gate no longer holds writes nothing (CT-006)", async () => {
    await sql`update properties set status = 'suspended' where id = ${propertyId}`.execute(db);
    const store = createLinkStore(db);

    expect(
      await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: allowed }),
    ).toBe(false);
    expect(await linkRows()).toEqual([]);
    expect(await counts()).toEqual({ audits: 0, events: 0 });
  });

  test("a removed host or a deny decision blocks the write (CT-010)", async () => {
    const store = createLinkStore(db);
    await sql`update program_revisions set payload = '{"allowedHosts": []}'::jsonb where program_id = ${programId}`.execute(
      db,
    );
    expect(
      await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: allowed }),
    ).toBe(false);

    await sql`update program_revisions set payload = ${JSON.stringify({ allowedHosts: [host] })}::jsonb
      where program_id = ${programId}`.execute(db);
    await sql`update eligibility_decisions set decision = 'deny' where id = 'eld_1'`.execute(db);
    expect(
      await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: allowed }),
    ).toBe(false);
    expect(await linkRows()).toEqual([]);
  });

  test("a write that passes the gate commits the link with its audit and event", async () => {
    const store = createLinkStore(db);
    expect(
      await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: allowed }),
    ).toBe(true);
    expect(await linkRows()).toEqual([{ id: linkId }]);
    expect(await counts()).toEqual({ audits: 1, events: 1 });
  });

  test("an update that passes the gate commits the new version with its audit and event", async () => {
    const store = createLinkStore(db);
    await store.insert({ record: record(), audit: audit("aud_1"), event: event("evt_1", 1), precondition: allowed });

    expect(
      await store.update({
        organizationId: orgA,
        expectedVersion: 1,
        record: record(2, "paused"),
        audit: audit("aud_2"),
        event: event("evt_2", 2),
        precondition: allowed,
      }),
    ).toBe(true);
    expect(await store.find(orgA, linkId)).toEqual(record(2, "paused"));
    expect(await counts()).toEqual({ audits: 2, events: 2 });
  });

  test("an internationalised allow-list entry matches its punycode destination host (CT-010)", async () => {
    await sql`update program_revisions set payload = '{"allowedHosts": ["bücher.de"]}'::jsonb where program_id = ${programId}`.execute(
      db,
    );
    const store = createLinkStore(db);
    const idn = { ...allowed, host: "xn--bcher-kva.de" };
    const punycode = { ...record(), link: { ...record().link, destinationUrl: "https://xn--bcher-kva.de/spring" } };

    expect(
      await store.insert({ record: punycode, audit: audit("aud_1"), event: event("evt_1", 1), precondition: idn }),
    ).toBe(true);
  });

  test("a suspension that commits while the write waits is refused, and nothing is written (CT-006)", async () => {
    const holder: PoolClient = await pool.connect();
    try {
      await holder.query("begin");
      // The suspension holds the property row until it commits, as its UPDATE does in the property store.
      await holder.query("update properties set status = 'suspended' where id = $1", [propertyId]);

      const store = createLinkStore(db);
      const pending = store.insert({
        record: record(),
        audit: audit("aud_1"),
        event: event("evt_1", 1),
        precondition: allowed,
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      await holder.query("commit");

      expect(await pending).toBe(false);
      expect(await linkRows()).toEqual([]);
      expect(await counts()).toEqual({ audits: 0, events: 0 });
    } finally {
      holder.release();
    }
  });

  test("a precondition that names another property or host than the record writes nothing", async () => {
    const store = createLinkStore(db);
    expect(
      await store.insert({
        record: record(),
        audit: audit("aud_1"),
        event: event("evt_1", 1),
        precondition: { ...allowed, host: "other.example.com" },
      }),
    ).toBe(false);
    expect(await linkRows()).toEqual([]);
  });
});
