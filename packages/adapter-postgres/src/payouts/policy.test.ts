import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  createPayoutPolicy,
  evaluatePayout,
  type PayoutHold,
  type PayoutPolicy,
  policyInEffect,
} from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createPayoutHoldStore, createPayoutPolicyStore } from "./policy";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

function inEffect(policies: readonly PayoutPolicy[], at: Date): PayoutPolicy {
  const policy = policyInEffect(policies, "GBP", at);
  if (!policy) throw new Error("no payout policy in effect");
  return policy;
}

const now = new Date("2026-03-01T10:00:00.000Z");
// Hold writes are bounded against the database clock, so they use the real write time.
const writeNow = () => new Date();
const actor = { type: "user", id: "usr_pol_one" };
const orgId = "org_pol_one";
const publisherId = "pub_pol_one";

describeWithDatabase("payout policy and holds (DM-045, TP-W7-009 to TP-W7-011)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;
  let policies: ReturnType<typeof createPayoutPolicyStore>;
  let holds: ReturnType<typeof createPayoutHoldStore>;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `pol_store_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);

    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${actor.id}, 'Finance', 'finance@example.com', true, ${now}, ${now})`.execute(db);
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values (${orgId}, ${orgId}, 'GB', 'GBP', 'active', ${actor.id}, ${now}, ${now})`.execute(db);
    await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at)
      values (${publisherId}, 'Pol Publisher', 'approved', ${orgId}, ${now}, ${now})`.execute(db);

    policies = createPayoutPolicyStore(db);
    holds = createPayoutHoldStore(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  const v1 = createPayoutPolicy({
    version: 1,
    currency: "GBP",
    minimumMinor: 5000n,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  });
  const v2 = createPayoutPolicy({
    version: 2,
    currency: "GBP",
    minimumMinor: 10000n,
    effectiveFrom: new Date("2027-06-01T00:00:00.000Z"),
  });

  const publish = (policy: typeof v1, auditId: string) =>
    policies.publish({ policy, auditId, organizationId: orgId, actor, occurredAt: writeNow() });

  test("publishes versions in order and refuses a taken version, a gap, or an effective date before the latest", async () => {
    expect(await publish(v1, "aud_pol_1")).toEqual({ outcome: "published" });
    expect(await publish(v1, "aud_pol_2")).toEqual({ outcome: "rejected", reason: "version_taken" });
    expect(await publish({ ...v2, version: 3 }, "aud_pol_3")).toEqual({ outcome: "rejected", reason: "version_gap" });
    expect(await publish({ ...v2, effectiveFrom: new Date("2025-12-01T00:00:00.000Z") }, "aud_pol_4")).toEqual({
      outcome: "rejected",
      reason: "effective_before_latest",
    });
    expect(await publish(v2, "aud_pol_5")).toEqual({ outcome: "published" });
  });

  test("a new version cannot take effect before the publish time (no backdating)", async () => {
    await publish(v1, "aud_pol_1");
    const backdated = { ...v2, effectiveFrom: new Date("2026-02-01T00:00:00.000Z") };
    expect(await publish(backdated, "aud_pol_6")).toEqual({ outcome: "rejected", reason: "effective_in_past" });
    expect(await policies.list("GBP")).toHaveLength(1);
  });

  test("a new version leaves the earlier version and the decisions made under it unchanged (TP-W7-011)", async () => {
    await publish(v1, "aud_pol_1");
    const before = new Date("2026-03-01T00:00:00.000Z");
    const decidedBefore = evaluatePayout({
      policy: inEffect(await policies.list("GBP"), before),
      availableMinor: 7000n,
      holds: [],
      at: before,
    });
    expect(decidedBefore).toMatchObject({ eligible: true, policyVersion: 1 });

    await publish(v2, "aud_pol_2");
    const stored = await policies.list("GBP");
    expect(stored.map((policy) => [policy.version, policy.minimumMinor])).toEqual([
      [1, 5000n],
      [2, 10000n],
    ]);
    expect(policyInEffect(stored, "GBP", before)).toEqual(v1);
    const decidedAfter = evaluatePayout({
      policy: inEffect(stored, before),
      availableMinor: 7000n,
      holds: [],
      at: before,
    });
    expect(decidedAfter).toEqual(decidedBefore);
  });

  test("the minimum is read back as an exact bigint", async () => {
    await publish(createPayoutPolicy({ ...v1, minimumMinor: 9007199254740993n }), "aud_pol_1");
    const [stored] = await policies.list("GBP");
    expect(stored?.minimumMinor).toBe(9007199254740993n);
  });

  test("a hold excludes the publisher until released, and a second release changes nothing", async () => {
    await holds.place({
      hold: {
        id: "pho_pol_1",
        publisherId,
        currency: "GBP",
        amountMinor: 2500n,
        reason: "chargeback review",
        expiresAt: null,
      },
      organizationId: orgId,
      auditId: "aud_hold_1",
      actor,
      occurredAt: writeNow(),
    });

    const active = await holds.listForPublisher(orgId, publisherId, "GBP");
    expect(active.map((hold: PayoutHold) => hold.reason)).toEqual(["chargeback review"]);
    const decision = evaluatePayout({
      policy: createPayoutPolicy(v1),
      availableMinor: 90000n,
      holds: active,
      at: writeNow(),
    });
    expect(decision).toMatchObject({ eligible: false, exclusions: ["held"] });

    const releasedAt = writeNow();
    expect(
      await holds.release({ id: "pho_pol_1", organizationId: orgId, auditId: "aud_hold_2", actor, releasedAt }),
    ).toBe(true);
    expect(
      await holds.release({ id: "pho_pol_1", organizationId: orgId, auditId: "aud_hold_3", actor, releasedAt }),
    ).toBe(false);
    expect((await holds.listForPublisher(orgId, publisherId, "GBP"))[0]?.releasedAt).toEqual(releasedAt);
  });

  test("a hold cannot be placed on, or released from, a publisher of another organization", async () => {
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values ('org_pol_two', 'org_pol_two', 'GB', 'GBP', 'active', ${actor.id}, ${now}, ${now})`.execute(db);
    await expect(
      holds.place({
        hold: {
          id: "pho_pol_4",
          publisherId,
          currency: "GBP",
          amountMinor: 1n,
          reason: "review",
          expiresAt: null,
        },
        organizationId: "org_pol_two",
        auditId: "aud_hold_7",
        actor,
        occurredAt: writeNow(),
      }),
    ).rejects.toThrow("payout: publisher is not in the organization");

    await holds.place({
      hold: {
        id: "pho_pol_5",
        publisherId,
        currency: "GBP",
        amountMinor: 1n,
        reason: "review",
        expiresAt: null,
      },
      organizationId: orgId,
      auditId: "aud_hold_8",
      actor,
      occurredAt: writeNow(),
    });
    expect(
      await holds.release({
        id: "pho_pol_5",
        organizationId: "org_pol_two",
        auditId: "aud_hold_9",
        actor,
        releasedAt: writeNow(),
      }),
    ).toBe(false);
  });

  test("placing and releasing a hold each write one audit row", async () => {
    await holds.place({
      hold: {
        id: "pho_pol_2",
        publisherId,
        currency: "GBP",
        amountMinor: 1n,
        reason: "review",
        expiresAt: null,
      },
      organizationId: orgId,
      auditId: "aud_hold_4",
      actor,
      occurredAt: writeNow(),
    });
    await holds.release({
      id: "pho_pol_2",
      organizationId: orgId,
      auditId: "aud_hold_5",
      actor,
      releasedAt: writeNow(),
    });

    const rows = await sql<{ action: string }>`select action from audit_logs
      where id in ('aud_hold_4', 'aud_hold_5') order by occurred_at, id`.execute(db);
    expect(rows.rows.map((row) => row.action)).toEqual(["payout_hold_placed", "payout_hold_released"]);
  });

  test("a hold amount must be positive", async () => {
    await expect(
      holds.place({
        hold: {
          id: "pho_pol_3",
          publisherId,
          currency: "GBP",
          amountMinor: 0n,
          reason: "review",
          expiresAt: null,
        },
        organizationId: orgId,
        auditId: "aud_hold_6",
        actor,
        occurredAt: writeNow(),
      }),
    ).rejects.toThrow(/violates check constraint/);
  });

  test("the database refuses to change a policy row, delete a hold, or edit a hold beyond its release", async () => {
    await publish(v1, "aud_pol_1");
    await holds.place({
      hold: {
        id: "pho_pol_6",
        publisherId,
        currency: "GBP",
        amountMinor: 1n,
        reason: "review",
        expiresAt: null,
      },
      organizationId: orgId,
      auditId: "aud_hold_10",
      actor,
      occurredAt: writeNow(),
    });

    await expect(sql`update payout_policies set minimum_minor = 1`.execute(db)).rejects.toThrow("immutable");
    await expect(sql`delete from payout_policies`.execute(db)).rejects.toThrow("immutable");
    await expect(sql`delete from payout_holds where id = 'pho_pol_6'`.execute(db)).rejects.toThrow("never deleted");
    await expect(sql`truncate payout_holds`.execute(db)).rejects.toThrow("never deleted");
    await expect(sql`truncate payout_policies`.execute(db)).rejects.toThrow("immutable");
    await expect(sql`update payout_holds set amount_minor = 99 where id = 'pho_pol_6'`.execute(db)).rejects.toThrow(
      "released once",
    );
    await expect(sql`update payout_holds set released_at = null where id = 'pho_pol_6'`.execute(db)).rejects.toThrow(
      "released once",
    );
  });

  test("a publish writes one audit row, and a refused publish writes none", async () => {
    await publish(v1, "aud_pol_audit_ok");
    expect(await publish(v1, "aud_pol_audit_refused")).toEqual({ outcome: "rejected", reason: "version_taken" });

    const rows = await sql<{ id: string; organization_id: string }>`select id, organization_id from audit_logs
      where action = 'payout_policy_published' order by id`.execute(db);
    expect(rows.rows).toEqual([{ id: "aud_pol_audit_ok", organization_id: orgId }]);

    // The policy row names the organization whose actor published it.
    const stored = await sql<{
      published_by_organization_id: string;
    }>`select published_by_organization_id from payout_policies
      where currency = 'GBP' and version = 1`.execute(db);
    expect(stored.rows[0]?.published_by_organization_id).toBe(orgId);
  });

  test("holds are unreadable from another organization", async () => {
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values ('org_pol_three', 'org_pol_three', 'GB', 'GBP', 'active', ${actor.id}, ${now}, ${now})`.execute(db);
    await holds.place({
      hold: { id: "pho_pol_8", publisherId, currency: "GBP", amountMinor: 1n, reason: "review", expiresAt: null },
      organizationId: orgId,
      auditId: "aud_hold_13",
      actor,
      occurredAt: writeNow(),
    });
    expect(await holds.listForPublisher("org_pol_three", publisherId, "GBP")).toEqual([]);
    expect(await holds.listForPublisher(orgId, publisherId, "GBP")).toHaveLength(1);
  });

  test("a release cannot precede the placement", async () => {
    const placedAt = writeNow();
    await holds.place({
      hold: {
        id: "pho_pol_7",
        publisherId,
        currency: "GBP",
        amountMinor: 1n,
        reason: "review",
        expiresAt: null,
      },
      organizationId: orgId,
      auditId: "aud_hold_11",
      actor,
      occurredAt: placedAt,
    });
    await expect(
      holds.release({
        id: "pho_pol_7",
        organizationId: orgId,
        auditId: "aud_hold_12",
        actor,
        releasedAt: new Date(placedAt.getTime() - 1000),
      }),
    ).rejects.toThrow("payout_holds_release_ck");
  });

  test("a hold cannot be placed or released with a time earlier than the write clock", async () => {
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await expect(
      holds.place({
        hold: { id: "pho_pol_9", publisherId, currency: "GBP", amountMinor: 1n, reason: "review", expiresAt: null },
        organizationId: orgId,
        auditId: "aud_hold_14",
        actor,
        occurredAt: anHourAgo,
      }),
    ).rejects.toThrow("earlier than the write clock");

    await holds.place({
      hold: { id: "pho_pol_10", publisherId, currency: "GBP", amountMinor: 1n, reason: "review", expiresAt: null },
      organizationId: orgId,
      auditId: "aud_hold_15",
      actor,
      occurredAt: writeNow(),
    });
    await expect(
      holds.release({ id: "pho_pol_10", organizationId: orgId, auditId: "aud_hold_16", actor, releasedAt: anHourAgo }),
    ).rejects.toThrow("earlier than the write clock");
  });

  test("the table refuses a hold inserted already released or expiring before placement", async () => {
    const placedAt = writeNow();
    await expect(
      sql`insert into payout_holds (id, publisher_id, currency, amount_minor, reason, expires_at, released_at, created_by, created_at)
        values ('pho_pol_11', ${publisherId}, 'GBP', 1, 'review', null, ${placedAt}, ${actor.id}, ${placedAt})`.execute(
        db,
      ),
    ).rejects.toThrow("may only be released after placement");
    await expect(
      sql`insert into payout_holds (id, publisher_id, currency, amount_minor, reason, expires_at, released_at, created_by, created_at)
        values ('pho_pol_12', ${publisherId}, 'GBP', 1, 'review', ${new Date(placedAt.getTime() - 1000)}, null, ${actor.id}, ${placedAt})`.execute(
        db,
      ),
    ).rejects.toThrow("payout_holds_expiry_ck");
  });

  test("a publish cannot be backdated to take a past decision's policy", async () => {
    await expect(
      policies.publish({
        policy: v1,
        auditId: "aud_pol_backdated",
        organizationId: orgId,
        actor,
        occurredAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    ).rejects.toThrow("earlier than the write clock");
    expect(await policies.list("GBP")).toEqual([]);
  });

  test("a hold cannot be placed with a time later than the write clock", async () => {
    await expect(
      holds.place({
        hold: { id: "pho_pol_13", publisherId, currency: "GBP", amountMinor: 1n, reason: "review", expiresAt: null },
        organizationId: orgId,
        auditId: "aud_hold_17",
        actor,
        occurredAt: new Date(Date.now() + 60 * 60 * 1000),
      }),
    ).rejects.toThrow("later than the write clock");
  });
});
