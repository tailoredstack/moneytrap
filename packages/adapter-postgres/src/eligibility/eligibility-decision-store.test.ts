import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EligibilityInput } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { createSourceFactStore } from "../catalog/source-fact-store";
import { migrate } from "../migrate";
import { createEligibilityDecisionStore } from "./eligibility-decision-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const now = new Date("2026-11-01T10:00:00.000Z");
const userId = "usr_elig_one";
const orgId = "org_elig_one";
const propertyId = "prp_elig_one";
const networkId = "net_elig_one";

const allowed: EligibilityInput = {
  publisher: { status: "approved" },
  property: { status: "approved" },
  program: { approval: "approved", countries: ["GB", "IE"], channels: ["web"] },
  geography: "GB",
  channel: "web",
  contract: { active: true, countries: ["GB", "IE"], channels: ["web"] },
  consent: { required: false, granted: false },
};

const denied: EligibilityInput = { ...allowed, geography: "FR" };

// The program facts the store reads from the seeded source revision (GB only, web only) replace the caller's program block.
function storedInputs(input: EligibilityInput): EligibilityInput {
  return { ...input, program: { approval: "approved", countries: ["GB"], channels: ["web"] } };
}

describeWithDatabase("eligibility decision store (TP-W4-022, TP-W4-023)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;
  let programId: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `elig_store_${crypto.randomUUID().replaceAll("-", "")}`;
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
      values (${propertyId}, ${orgId}, 'pub_elig_one', 'website', 'example.com', 'example.com', 'approved', 1, ${now}, ${now})`.execute(
      db,
    );
    await sql`insert into networks (id, code, name, created_at, updated_at)
      values (${networkId}, ${networkId}, ${networkId}, now(), now())`.execute(db);

    // The program is a source fact (WP-4.5), created through the same store the catalog sync uses.
    const facts = createSourceFactStore(db);
    const advertiser = await facts.upsertNetworkAdvertiser({
      id: "nad_elig_one",
      networkId,
      sourceId: "adv-1",
      sourceRevision: "r1",
      payload: { name: "Acme" },
      observedAt: now,
    });
    const program = await facts.upsertProgram({
      id: "prg_elig_one",
      networkAdvertiserId: advertiser?.id ?? "",
      sourceId: "prg-1",
      sourceRevision: "r1",
      payload: {
        name: "Acme Summer",
        terms: "30 day",
        eligibility: "all",
        countries: ["GB"],
        channels: ["web"],
        approval: "approved",
      },
      observedAt: now,
    });
    programId = program?.id ?? "";
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  let sequence = 0;
  function writeFor(input: EligibilityInput) {
    sequence += 1;
    return {
      id: `eld_${sequence}`,
      auditId: `aud_elig_${sequence}`,
      organizationId: orgId,
      propertyId,
      programId,
      input,
      actor: { type: "user", id: userId },
      occurredAt: now,
    };
  }

  async function countRows(table: "eligibility_decisions" | "audit_logs"): Promise<number> {
    const result = await sql<{ n: string }>`select count(*)::text as n from ${sql.table(table)}`.execute(db);
    return Number(result.rows[0]?.n ?? 0);
  }

  test("a decision is stored with its policy version, reasons, checks, and inputs", async () => {
    const store = createEligibilityDecisionStore(db);
    const result = await store.record(writeFor(denied));

    expect(result.outcome).toBe("recorded");
    expect(result.decision.decision).toBe("deny");
    expect(result.decision.policyVersion).toBe(1);
    expect(result.decision.reasons).toEqual(["geography"]);
    expect(result.decision.inputs).toEqual(storedInputs(denied));
    expect(result.decision.checks.find((check) => check.reason === "geography")?.passed).toBe(false);

    const stored = await store.find(orgId, result.decision.id);
    expect(stored?.reasons).toEqual(["geography"]);
    expect(stored?.inputs).toEqual(storedInputs(denied));
  });

  test("the same inputs twice give an identical decision and no duplicate row (TP-W4-023)", async () => {
    const store = createEligibilityDecisionStore(db);
    const first = await store.record(writeFor(allowed));
    const second = await store.record(writeFor(allowed));

    expect(first.outcome).toBe("recorded");
    expect(second.outcome).toBe("existing");
    expect(second.decision.id).toBe(first.decision.id);
    expect(second.decision.checks).toEqual(first.decision.checks);
    expect(await countRows("eligibility_decisions")).toBe(1);
    expect(await countRows("audit_logs")).toBe(1);
  });

  test("a decision under an earlier policy version is kept when a new one is recorded (TP-W4-022)", async () => {
    // Version 0 stands in for an earlier policy: the row is written directly, as an earlier build would have.
    await sql`insert into eligibility_decisions (id, organization_id, property_id, program_id, policy_version, decision,
        reasons, checks, inputs, input_hash, evaluated_at)
      values ('eld_old', ${orgId}, ${propertyId}, ${programId}, 0, 'allow', '[]'::jsonb, '[]'::jsonb,
        ${JSON.stringify(allowed)}::jsonb, 'hash-v0', ${now})`.execute(db);

    const store = createEligibilityDecisionStore(db);
    const result = await store.record(writeFor(allowed));

    expect(result.outcome).toBe("recorded");
    const history = await store.listForPair(orgId, propertyId, programId);
    expect(history.map((decision) => decision.policyVersion)).toEqual([0, 1]);
    expect(history[0]?.id).toBe("eld_old");
  });

  test("a stored decision reproduces from its stored inputs", async () => {
    const store = createEligibilityDecisionStore(db);
    const { decision } = await store.record(writeFor(denied));

    expect(await store.replay(orgId, decision.id)).toBe("reproduced");
  });

  test("a decision under a policy version this build lacks cannot be replayed", async () => {
    await sql`insert into eligibility_decisions (id, organization_id, property_id, program_id, policy_version, decision,
        reasons, checks, inputs, input_hash, evaluated_at)
      values ('eld_old', ${orgId}, ${propertyId}, ${programId}, 0, 'allow', '[]'::jsonb, '[]'::jsonb,
        ${JSON.stringify(allowed)}::jsonb, 'hash-v0', ${now})`.execute(db);

    const store = createEligibilityDecisionStore(db);
    expect(await store.replay(orgId, "eld_old")).toBe("policy_unavailable");
    expect(await store.replay(orgId, "eld_missing")).toBeNull();
  });

  test("a stored decision that no longer matches its inputs replays as a mismatch", async () => {
    const store = createEligibilityDecisionStore(db);
    const { decision } = await store.record(writeFor(denied));
    // Tamper with the stored evidence, as an out-of-band edit would. The replay must notice.
    await sql`update eligibility_decisions set checks = '[]'::jsonb where id = ${decision.id}`.execute(db);

    expect(await store.replay(orgId, decision.id)).toBe("mismatch");
  });

  test("reads and writes are scoped to the organization", async () => {
    const store = createEligibilityDecisionStore(db);
    const { decision } = await store.record(writeFor(allowed));

    expect(await store.find("org_other", decision.id)).toBeNull();
    expect(await store.listForPair("org_other", propertyId, programId)).toEqual([]);
    expect(await store.replay("org_other", decision.id)).toBeNull();
    // A decision cannot be written for a property that belongs to another organization.
    await expect(store.record({ ...writeFor(allowed), organizationId: "org_other" })).rejects.toThrow(
      "not in the organization",
    );
    expect(await countRows("eligibility_decisions")).toBe(1);
  });

  test("the same inputs written concurrently record one row and one audit row", async () => {
    const store = createEligibilityDecisionStore(db);
    const results = await Promise.all([store.record(writeFor(allowed)), store.record(writeFor(allowed))]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["existing", "recorded"]);
    expect(await countRows("eligibility_decisions")).toBe(1);
    expect(await countRows("audit_logs")).toBe(1);
  });

  test("the same set of list values in another order is the same evaluation", async () => {
    const store = createEligibilityDecisionStore(db);
    const reordered: EligibilityInput = {
      ...allowed,
      contract: { ...allowed.contract, countries: ["IE", "GB"] },
    };
    await store.record(writeFor(allowed));
    const second = await store.record(writeFor(reordered));

    expect(second.outcome).toBe("existing");
    expect(await countRows("eligibility_decisions")).toBe(1);
  });

  test("a program with no stored source revision is denied as unknown, not allowed", async () => {
    // A program row exists but has never had a revision, so there are no facts to decide on.
    await sql`insert into programs (id, network_advertiser_id, external_id, current_revision_seq, created_at, updated_at)
      values ('prg_bare', 'nad_elig_one', 'prg-bare', 0, ${now}, ${now})`.execute(db);

    const store = createEligibilityDecisionStore(db);
    const result = await store.record({ ...writeFor(allowed), programId: "prg_bare" });

    expect(result.decision.decision).toBe("deny");
    expect(result.decision.reasons).toContain("unknown");
  });

  test("letter case and repeated values do not create a second row", async () => {
    const store = createEligibilityDecisionStore(db);
    await store.record(writeFor(allowed));
    const shouted: EligibilityInput = {
      ...allowed,
      geography: "gb",
      contract: { ...allowed.contract, countries: ["gb", "GB", "IE"] },
    };
    const second = await store.record(writeFor(shouted));

    expect(second.outcome).toBe("existing");
    expect(await countRows("eligibility_decisions")).toBe(1);
  });

  test("replay reports a mismatch when the stored inputs no longer hash to the stored key", async () => {
    const store = createEligibilityDecisionStore(db);
    const { decision } = await store.record(writeFor(allowed));
    // Edit the inputs, leaving checks and the key alone. The recomputed hash differs from the stored key.
    await sql`update eligibility_decisions set inputs = jsonb_set(inputs, '{geography}', '"FR"')
      where id = ${decision.id}`.execute(db);

    expect(await store.replay(orgId, decision.id)).toBe("mismatch");
  });

  test("the decision and its audit row commit together (no partial write)", async () => {
    // Pre-insert an audit row with the ID the next write will use. The audit insert then fails on its primary key, and
    // the decision insert, which ran first in the same transaction, must roll back with it.
    await sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
      values ('aud_clash', ${orgId}, 'user', ${userId}, 'other', 'other', 'other', '{}'::jsonb, ${now})`.execute(db);

    const store = createEligibilityDecisionStore(db);
    const write = { ...writeFor(allowed), auditId: "aud_clash" };
    await expect(store.record(write)).rejects.toThrow();

    expect(await countRows("eligibility_decisions")).toBe(0);
    expect(await countRows("audit_logs")).toBe(1);
  });

  test("a recorded decision writes one audit row that points at it", async () => {
    const store = createEligibilityDecisionStore(db);
    const { decision } = await store.record(writeFor(denied));

    const audit = await sql<{
      action: string;
      entity_type: string;
      entity_id: string;
      metadata: { reasons: string[] };
    }>`
      select action, entity_type, entity_id, metadata from audit_logs`.execute(db);
    expect(audit.rows).toEqual([
      {
        action: "eligibility_decided",
        entity_type: "eligibility_decision",
        entity_id: decision.id,
        metadata: expect.objectContaining({ decision: "deny", reasons: ["geography"], policyVersion: 1 }),
      },
    ]);
  });
});
