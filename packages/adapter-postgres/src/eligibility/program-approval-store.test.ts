import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Id, ProgramFactPayload } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { createSourceFactStore } from "../catalog/source-fact-store";
import { migrate } from "../migrate";
import { createProgramApprovalStore } from "./program-approval-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const now = new Date("2026-11-01T10:00:00.000Z");
const userId = "usr_pga_one";
const orgId = "org_pga_one" as Id<"organization">;
const otherOrgId = "org_pga_two" as Id<"organization">;
const propertyId = "prp_pga_one" as Id<"property">;
const otherPropertyId = "prp_pga_two" as Id<"property">;
const networkId = "net_pga_one";
const programId = "prg_pga_one";

const facts = (approval: ProgramFactPayload["approval"]): ProgramFactPayload => ({
  name: "Acme Summer",
  terms: "30 day",
  eligibility: "all",
  countries: ["GB"],
  channels: ["web"],
  approval,
});

describeWithDatabase("program approval store (TP-W4-024, TP-W4-025)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;
  let advertiserId: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `pga_store_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);

    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Owner', 'owner@example.com', true, ${now}, ${now})`.execute(db);
    for (const [org, property] of [
      [orgId, propertyId],
      [otherOrgId, otherPropertyId],
    ] as const) {
      await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
        values (${org}, ${org}, 'GB', 'GBP', 'active', ${userId}, ${now}, ${now})`.execute(db);
      await sql`insert into properties (id, organization_id, publisher_id, type, canonical_identifier, normalized_identifier,
          status, version, created_at, updated_at)
        values (${property}, ${org}, ${`pub_${property}`}, 'website', ${`${property}.example.com`},
          ${`${property}.example.com`}, 'approved', 1, ${now}, ${now})`.execute(db);
    }
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values (${networkId}, ${networkId}, ${networkId}, now(), now())`.execute(db);

    // The program is a source fact (WP-4.5), created through the same store the catalog sync uses.
    const source = createSourceFactStore(db);
    const advertiser = await source.upsertNetworkAdvertiser({
      id: "nad_pga_one",
      networkId,
      sourceId: "adv-1",
      sourceRevision: "r1",
      payload: { name: "Acme" },
      observedAt: now,
    });
    advertiserId = advertiser?.id ?? "";
    await source.upsertProgram({
      id: programId,
      networkAdvertiserId: advertiserId,
      sourceId: "prg-1",
      sourceRevision: "r1",
      payload: facts(null),
      observedAt: now,
    });
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  // The network reports approval through a new source revision, as the catalog sync writes it.
  async function syncApproval(approval: ProgramFactPayload["approval"], sourceRevision: string) {
    await createSourceFactStore(db).upsertProgram({
      id: `prg_pga_sync_${sourceRevision}`,
      networkAdvertiserId: advertiserId,
      sourceId: "prg-1",
      sourceRevision,
      payload: facts(approval),
      observedAt: now,
    });
  }

  let sequence = 0;
  function writeFor(property = propertyId, organization = orgId) {
    sequence += 1;
    return {
      organizationId: organization,
      propertyId: property,
      programId,
      requestedAt: now,
      actor: { type: "user", id: userId },
      audit: { id: `aud_pga_${sequence}` as Id<"audit">, metadata: { propertyId: property, programId } },
      event: { id: `evt_pga_${sequence}` as Id<"event">, payload: { propertyId: property, programId } },
    };
  }

  async function count(table: "publisher_program_approvals" | "audit_logs" | "outbox_events"): Promise<number> {
    const result = await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)}`.execute(db);
    return Number(result.rows[0]?.n ?? 0);
  }

  test("a request is stored as requested, with its audit row and event, and no approval", async () => {
    const store = createProgramApprovalStore(db);
    const outcome = await store.request(writeFor());

    expect(outcome.kind).toBe("recorded");
    if (outcome.kind !== "recorded") return;
    expect(outcome.record.networkApproval).toBeNull();
    expect(await count("publisher_program_approvals")).toBe(1);
    expect(await count("outbox_events")).toBe(1);
    const audit = await sql<{ action: string; entity_id: string }>`select action, entity_id from audit_logs`.execute(
      db,
    );
    expect(audit.rows.map((row) => row.action)).toEqual(["program_approval.requested"]);
    // The entity is the property-program pair, so an entity query isolates this one request.
    expect(audit.rows[0]?.entity_id).toBe(`${propertyId}|${programId}`);
  });

  test("a repeat request writes no second row, audit, or event", async () => {
    const store = createProgramApprovalStore(db);
    await store.request(writeFor());
    const repeat = await store.request(writeFor());

    expect(repeat.kind).toBe("existing");
    expect(await count("publisher_program_approvals")).toBe(1);
    expect(await count("audit_logs")).toBe(1);
    expect(await count("outbox_events")).toBe(1);
  });

  test("two properties can request the same program, each with its own event", async () => {
    const store = createProgramApprovalStore(db);
    await sql`insert into properties (id, organization_id, publisher_id, type, canonical_identifier, normalized_identifier,
        status, version, created_at, updated_at)
      values (${"prp_pga_three"}, ${orgId}, 'pub_pga_three', 'website', 'three.example.com',
        'three.example.com', 'approved', 1, ${now}, ${now})`.execute(db);

    expect((await store.request(writeFor())).kind).toBe("recorded");
    expect((await store.request(writeFor("prp_pga_three" as Id<"property">))).kind).toBe("recorded");
    expect(await count("publisher_program_approvals")).toBe(2);
    expect(await count("outbox_events")).toBe(2);
  });

  test("the status follows the network's approval, not the request (TP-W4-025)", async () => {
    const store = createProgramApprovalStore(db);
    await store.request(writeFor());

    expect((await store.find(orgId, propertyId, programId))?.networkApproval).toBeNull();
    await syncApproval("pending", "r2");
    expect((await store.find(orgId, propertyId, programId))?.networkApproval).toBe("pending");
    await syncApproval("approved", "r3");
    expect((await store.find(orgId, propertyId, programId))?.networkApproval).toBe("approved");
  });

  test("a property of another organization is refused and nothing is written", async () => {
    const store = createProgramApprovalStore(db);
    const outcome = await store.request(writeFor(propertyId, otherOrgId));

    expect(outcome.kind).toBe("unknown_property");
    expect(await count("publisher_program_approvals")).toBe(0);
  });

  test("a program that does not exist is refused and nothing is written", async () => {
    const store = createProgramApprovalStore(db);
    const outcome = await store.request({ ...writeFor(), programId: "prg_missing" });

    expect(outcome.kind).toBe("unknown_program");
    expect(await count("publisher_program_approvals")).toBe(0);
  });

  test("a request is not visible to another organization", async () => {
    const store = createProgramApprovalStore(db);
    await store.request(writeFor());

    expect(await store.find(otherOrgId, propertyId, programId)).toBeNull();
  });
});
