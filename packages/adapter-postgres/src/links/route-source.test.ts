import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createRouteSource } from "./route-source";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const now = new Date("2026-11-01T10:00:00.000Z");
const userId = "usr_01arz3ndektsv4rrffq69g5fav";
const orgId = "org_01arz3ndektsv4rrffq69g5fav";
const propertyId = "prp_01arz3ndektsv4rrffq69g5fav";
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav";
const programId = "prg_01arz3ndektsv4rrffq69g5fav";
const linkId = "lnk_01arz3ndektsv4rrffq69g5fav";
const host = "shop.example.com";

describeWithDatabase("route source (WP-5.6, ADR-007)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `routes_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
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
      values (${propertyId}, ${orgId}, ${publisherId}, 'website', ${host}, ${host}, 'approved', 1, ${now}, ${now})`.execute(
      db,
    );
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values ('net_1', 'net_1', 'Net', ${now}, ${now})`.execute(db);
    await sql`insert into network_advertisers (id, network_id, external_id, created_at, updated_at)
      values ('adv_1', 'net_1', 'adv', ${now}, ${now})`.execute(db);
    await sql`insert into programs (id, network_advertiser_id, external_id, created_at, updated_at)
      values (${programId}, 'adv_1', 'prg', ${now}, ${now})`.execute(db);
    await sql`insert into links (id, organization_id, publisher_id, property_id, program_id, slug, destination_url, status,
        version, created_at, updated_at)
      values (${linkId}, ${orgId}, ${publisherId}, ${propertyId}, ${programId}, 'spring',
        ${`https://${host}/spring`}, 'active', 2, ${now}, ${now})`.execute(db);
    await decide("allow");
  });

  afterEach(async () => {
    await db.destroy();
    const teardown = new Pool({ connectionString: databaseUrl });
    await teardown.query(`drop schema "${schema}" cascade`);
    await teardown.end();
  });

  // Appends an evaluation with the given outcome, as the eligibility store does, so the latest one decides.
  async function decide(decision: "allow" | "deny", decisionId = `eld_${crypto.randomUUID().slice(0, 8)}`) {
    await sql`insert into eligibility_decisions (id, organization_id, property_id, program_id, policy_version, decision,
        reasons, checks, inputs, input_hash, evaluated_at)
      values (${decisionId}, ${orgId}, ${propertyId}, ${programId}, 1, ${decision}, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb,
        ${`hash-${decisionId}`}, ${now})`.execute(db);
    await sql`insert into eligibility_evaluations (organization_id, property_id, program_id, decision_id, evaluated_at)
      values (${orgId}, ${propertyId}, ${programId}, ${decisionId}, ${now})`.execute(db);
  }

  test("returns the link and eligible for an approved property with an allow decision", async () => {
    const found = await createRouteSource(db).findByToken(linkId);
    expect(found).toEqual({
      link: {
        id: linkId as Id<"link">,
        publisherId: publisherId as Id<"publisher">,
        propertyId: propertyId as Id<"property">,
        slug: "spring",
        destinationUrl: `https://${host}/spring`,
        status: "active",
        version: 2,
      },
      eligible: true,
    });
  });

  test("uses the latest evaluation, so a later deny makes the route ineligible", async () => {
    await decide("deny");
    const found = await createRouteSource(db).findByToken(linkId);
    expect(found?.eligible).toBe(false);
  });

  test("an unapproved property is ineligible even with an allow decision", async () => {
    await sql`update properties set status = 'suspended' where id = ${propertyId}`.execute(db);
    const found = await createRouteSource(db).findByToken(linkId);
    expect(found?.eligible).toBe(false);
  });

  test("a link with no recorded decision is ineligible", async () => {
    await sql`delete from eligibility_evaluations`.execute(db);
    const found = await createRouteSource(db).findByToken(linkId);
    expect(found?.eligible).toBe(false);
  });

  test("returns null for an unknown token", async () => {
    expect(await createRouteSource(db).findByToken("lnk_unknown")).toBeNull();
  });
});
