import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PayoutMethodWrite } from "@moneytrap/app/src/ports/payout-method-store";
import type { Id } from "@moneytrap/domain";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { createPayoutMethodStore } from "./methods";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const userId = "usr_01arz3ndektsv4rrffq69g5fav";
const orgId = "org_01arz3ndektsv4rrffq69g5fav" as Id<"organization">;
const otherOrgId = "org_01brz3ndektsv4rrffq69g5fav" as Id<"organization">;
const publisherId = "pub_01arz3ndektsv4rrffq69g5fav" as Id<"publisher">;
const now = new Date("2026-03-01T00:00:00.000Z");
const operator = { type: "user", id: userId };

function writeFor(id: string, providerAccountRef: string, organizationId = orgId): PayoutMethodWrite {
  return {
    organizationId,
    record: {
      id: id as Id<"payoutMethod">,
      publisherId,
      provider: "acme_pay",
      providerAccountRef,
      country: "NL",
      currency: "EUR",
      state: "active",
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    audit: {
      id: `aud_${id}` as Id<"audit">,
      actor: operator,
      action: "payout_method.enrolled",
      entityId: id as Id<"payoutMethod">,
      metadata: { publisherId, provider: "acme_pay" },
      occurredAt: now,
    },
  };
}

describeWithDatabase("payout method store (TP-W7-007, TP-W7-008, DM-046, WP-7.5)", () => {
  let pool: Pool;
  let db: Kysely<unknown>;
  let schema: string;

  beforeEach(async () => {
    // A private schema per test keeps the shared test database untouched.
    schema = `payout_methods_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Pool({ connectionString: databaseUrl });
    await setup.query(`create schema "${schema}"`);
    await setup.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values (${userId}, 'Owner', 'owner@example.com', true, ${now}, ${now})`.execute(db);
    for (const org of [orgId, otherOrgId]) {
      await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
        values (${org}, ${org}, 'NL', 'EUR', 'active', ${userId}, ${now}, ${now})`.execute(db);
    }
    await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at)
      values (${publisherId}, 'Acme Media', 'approved', ${orgId}, ${now}, ${now})`.execute(db);
  });

  afterEach(async () => {
    await db.destroy();
    const cleanup = new Pool({ connectionString: databaseUrl });
    await cleanup.query(`drop schema if exists "${schema}" cascade`);
    await cleanup.end();
  });

  test("an enrolled method and its audit row commit together; the audit row holds no account reference", async () => {
    const store = createPayoutMethodStore(db);
    expect(await store.insert(writeFor("pmt_one", "acct_hosted_7f3a"))).toBe("created");

    const audits = await sql<{ organization_id: string | null; action: string; metadata: unknown }>`
      select organization_id, action, metadata from audit_logs where entity_type = 'payout_method'
    `.execute(db);
    expect(audits.rows).toEqual([
      { organization_id: orgId, action: "payout_method.enrolled", metadata: { publisherId, provider: "acme_pay" } },
    ]);
  });

  test("the row holds the provider reference and no account detail column", async () => {
    await createPayoutMethodStore(db).insert(writeFor("pmt_one", "acct_hosted_7f3a"));
    const columns = await sql<{ column_name: string }>`
      select column_name from information_schema.columns
      where table_schema = ${schema} and table_name = 'payout_methods'
    `.execute(db);
    expect(columns.rows.map((row) => row.column_name).sort()).toEqual(
      [
        "country",
        "created_at",
        "currency",
        "id",
        "provider",
        "provider_account_ref",
        "publisher_id",
        "state",
        "updated_at",
        "verified_at",
      ].sort(),
    );
  });

  test("a provider reference is unique per provider; the second enrollment writes nothing", async () => {
    const store = createPayoutMethodStore(db);
    expect(await store.insert(writeFor("pmt_one", "acct_hosted_7f3a"))).toBe("created");
    expect(await store.insert(writeFor("pmt_two", "acct_hosted_7f3a"))).toBe("duplicate");
    const rows = await sql<{ count: string }>`select count(*)::text as count from payout_methods`.execute(db);
    expect(rows.rows[0]?.count).toBe("1");
  });

  test("a publisher in another organization is unknown and nothing is written", async () => {
    const store = createPayoutMethodStore(db);
    expect(await store.insert(writeFor("pmt_one", "acct_hosted_7f3a", otherOrgId))).toBe("unknown_publisher");
    const rows = await sql<{ count: string }>`select count(*)::text as count from payout_methods`.execute(db);
    expect(rows.rows[0]?.count).toBe("0");
  });

  test("listing and disabling are scoped to the organization", async () => {
    const store = createPayoutMethodStore(db);
    await store.insert(writeFor("pmt_one", "acct_hosted_7f3a"));

    expect((await store.listForOrganization(orgId)).map((row) => row.state)).toEqual(["active"]);
    expect(await store.listForOrganization(otherOrgId)).toEqual([]);

    const at = new Date("2026-03-02T00:00:00.000Z");
    const audit = writeFor("pmt_one", "x").audit;
    const disableAudit = {
      ...audit,
      id: "aud_disable_pmt_one" as Id<"audit">,
      action: "payout_method.disabled" as const,
      metadata: {},
    };
    expect(
      await store.disable({ organizationId: otherOrgId, id: "pmt_one" as Id<"payoutMethod">, at, audit: disableAudit }),
    ).toBe("not_found");
    expect(
      await store.disable({ organizationId: orgId, id: "pmt_one" as Id<"payoutMethod">, at, audit: disableAudit }),
    ).toBe("disabled");
    expect(
      await store.disable({ organizationId: orgId, id: "pmt_one" as Id<"payoutMethod">, at, audit: disableAudit }),
    ).toBe("already_disabled");
  });

  test("TP-W7-008: the database refuses a reference that is not a provider reference", async () => {
    const rejected = sql`insert into payout_methods (id, publisher_id, provider, provider_account_ref, country, currency,
      state, verified_at, created_at, updated_at)
      values ('pmt_bad', ${publisherId}, 'acme_pay', 'NL91 ABNA 0417 1643 00', 'NL', 'EUR', 'active', ${now}, ${now}, ${now})`;
    await expect(rejected.execute(db)).rejects.toThrow(/payout_methods_provider_account_ref_check/);
  });

  test("an active method must carry a verification time", async () => {
    const missing = sql`insert into payout_methods (id, publisher_id, provider, provider_account_ref, country, currency,
      state, verified_at, created_at, updated_at)
      values ('pmt_unverified', ${publisherId}, 'acme_pay', 'acct_1', 'NL', 'EUR', 'active', null, ${now}, ${now})`;
    await expect(missing.execute(db)).rejects.toThrow(/payout_methods_verified_ck/);
  });
});
