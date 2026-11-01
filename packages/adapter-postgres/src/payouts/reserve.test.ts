import { describe, expect, test } from "bun:test";
import { runPayoutBatchStoreContract } from "@moneytrap/test-kit/src/contracts/payout-batch-store";
import { fixtureId } from "@moneytrap/test-kit/src/fixtures/ids";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { migrate } from "../migrate";
import { migrationProvider } from "../migrations/index";
import { createPayoutBatchStore } from "./reserve";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const now = new Date("2026-11-01T00:00:00.000Z");
const organizationId = fixtureId("organization", 1);
const otherOrganizationId = fixtureId("organization", 2);
const userId = fixtureId("user", 1);

// Each world gets a private schema with the migrations applied and two organizations, so the foreign keys hold.
async function openPostgres() {
  const schema = `reserve_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create schema "${schema}"`);
  await admin.end();

  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}`, max: 12 });
  const db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
  await migrate(db);
  await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values (${userId}, 'Finance', 'finance@example.com', true, ${now}, ${now})`.execute(db);
  for (const id of [organizationId, otherOrganizationId]) {
    await sql`insert into organizations (id, name, country, base_currency, status, created_by, created_at, updated_at)
      values (${id}, ${id}, 'GB', 'GBP', 'active', ${userId}, ${now}, ${now})`.execute(db);
  }

  return {
    store: createPayoutBatchStore(db),
    db,
    organizationId,
    otherOrganizationId,
    userId,
    async addPublisher(input: { organizationId: string; publisherId: string; methodId: string; currency: string }) {
      await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at)
        values (${input.publisherId}, ${input.publisherId}, 'approved', ${input.organizationId}, ${now}, ${now})`.execute(
        db,
      );
      await sql`insert into payout_methods (id, publisher_id, provider, provider_account_ref, country, currency, state,
        verified_at, created_at, updated_at)
        values (${input.methodId}, ${input.publisherId}, 'simulator', ${`acct_${input.methodId}`}, 'GB', ${input.currency},
          'active', ${now}, ${now}, ${now})`.execute(db);
    },
    async close() {
      await db.destroy();
      const cleanup = new Pool({ connectionString: databaseUrl });
      await cleanup.query(`drop schema if exists "${schema}" cascade`);
      await cleanup.end();
    },
  };
}

if (databaseUrl) runPayoutBatchStoreContract([{ name: "Postgres", open: openPostgres as never }]);

describeWithDatabase("payout batch tables (DM-047, DM-048)", () => {
  async function withPostgres(run: (world: Awaited<ReturnType<typeof openPostgres>>) => Promise<void>) {
    const world = await openPostgres();
    try {
      await run(world);
    } finally {
      await world.close();
    }
  }

  async function reserveOne(world: Awaited<ReturnType<typeof openPostgres>>, n = 1) {
    const publisherId = fixtureId("publisher", n);
    const methodId = fixtureId("payoutMethod", n);
    await world.addPublisher({ organizationId, publisherId, methodId, currency: "GBP" });
    const batchId = fixtureId("payoutBatch", n);
    const outcome = await world.store.reserve({
      organizationId,
      batchId,
      reservationKey: `reservation-${n}`,
      currency: "GBP",
      periodStart: new Date("2026-10-01T00:00:00.000Z"),
      periodEnd: new Date("2026-10-31T00:00:00.000Z"),
      capMinor: null,
      policyVersion: 1,
      createdBy: userId,
      createdAt: now,
      lines: [
        {
          payoutId: fixtureId("payout", n),
          publisherId,
          methodId,
          requestedMinor: 5_000n,
          availableMinor: 5_000n,
          minimumMinor: 1_000n,
        },
      ],
      audit: { id: fixtureId("audit", n), actor: { type: "user", id: userId }, occurredAt: now },
    });
    expect(outcome.outcome).toBe("reserved");
    return { batchId, payoutId: fixtureId("payout", n), publisherId, methodId };
  }

  test("a prepare writes the batch, the payout, and one audit row together", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      const audits = await sql<{ action: string; metadata: { totalMinor: string; payoutCount: number } }>`
        select action, metadata from audit_logs where entity_id = ${batchId}`.execute(world.db);
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.action).toBe("payout_batch.prepared");
      expect(audits.rows[0]?.metadata).toMatchObject({ totalMinor: "5000", payoutCount: 1 });
    });
  });

  test("cancel writes its audit row with the freed amount", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      const outcome = await world.store.cancel({
        organizationId,
        batchId,
        at: now,
        audit: { id: fixtureId("audit", 50), actor: { type: "user", id: userId }, occurredAt: now },
      });
      expect(outcome).toBe("cancelled");
      const audits = await sql<{ metadata: { freedMinor: string } }>`
        select metadata from audit_logs where entity_id = ${batchId} and action = 'payout_batch.cancelled'`.execute(
        world.db,
      );
      expect(audits.rows[0]?.metadata.freedMinor).toBe("5000");
    });
  });

  test("a payout can only be cancelled once, and never edited or deleted", async () => {
    await withPostgres(async (world) => {
      const { payoutId, batchId } = await reserveOne(world);
      await expect(
        sql`update payouts set amount_minor = 9999 where id = ${payoutId}`.execute(world.db),
      ).rejects.toThrow(/may only be cancelled once/);
      await expect(sql`delete from payouts where id = ${payoutId}`.execute(world.db)).rejects.toThrow(/never deleted/);
      await expect(sql`delete from payout_batches where id = ${batchId}`.execute(world.db)).rejects.toThrow(
        /never deleted/,
      );
      await expect(sql`truncate payouts`.execute(world.db)).rejects.toThrow(/never deleted/);
      await sql`update payouts set state = 'cancelled', cancelled_at = ${now} where id = ${payoutId}`.execute(world.db);
      await expect(
        sql`update payouts set state = 'reserved', cancelled_at = null where id = ${payoutId}`.execute(world.db),
      ).rejects.toThrow(/may only be cancelled once/);
    });
  });

  test("the database refuses a payout that is not reserved, has no amount, or names another publisher's method", async () => {
    await withPostgres(async (world) => {
      const { batchId, methodId } = await reserveOne(world);
      const other = fixtureId("publisher", 2);
      await world.addPublisher({
        organizationId,
        publisherId: other,
        methodId: fixtureId("payoutMethod", 2),
        currency: "GBP",
      });
      const insert = (overrides: { state?: string; amount?: string; methodId?: string; key?: string }) =>
        sql`insert into payouts (id, batch_id, publisher_id, method_id, currency, amount_minor, reservation_key,
          idempotency_key, state, created_at, cancelled_at)
          values (${`pay_x${crypto.randomUUID().slice(0, 8)}`}, ${batchId}, ${other}, ${overrides.methodId ?? fixtureId("payoutMethod", 2)},
            'GBP', ${overrides.amount ?? "100"}, 'reservation-1', ${overrides.key ?? crypto.randomUUID()},
            ${overrides.state ?? "reserved"}, ${now}, ${overrides.state === "cancelled" ? now : null})`.execute(
          world.db,
        );
      await expect(insert({ state: "cancelled" })).rejects.toThrow(/inserted reserved/);
      await expect(insert({ amount: "0" })).rejects.toThrow();
      await expect(insert({ methodId })).rejects.toThrow();
      await insert({});
      // The same reservation key cannot reserve a second payout for the same publisher.
      await expect(insert({})).rejects.toThrow();
    });
  });

  test("the database refuses a reservation key reused with a second payout row for one publisher", async () => {
    await withPostgres(async (world) => {
      const { batchId, publisherId, methodId } = await reserveOne(world);
      await expect(
        sql`insert into payouts (id, batch_id, publisher_id, method_id, currency, amount_minor, reservation_key,
          idempotency_key, state, created_at)
          values (${fixtureId("payout", 99)}, ${batchId}, ${publisherId}, ${methodId}, 'GBP', 1, 'reservation-1', 'other-key',
            'reserved', ${now})`.execute(world.db),
      ).rejects.toThrow(/payouts_publisher_reservation_key_uq/);
    });
  });

  test("the database refuses a payout whose reservation key differs from its batch or whose publisher is in another organization", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      const outsider = fixtureId("publisher", 2);
      await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at)
        values (${outsider}, 'Outsider', 'approved', ${otherOrganizationId}, ${now}, ${now})`.execute(world.db);
      await sql`insert into payout_methods (id, publisher_id, provider, provider_account_ref, country, currency, state,
        verified_at, created_at, updated_at)
        values (${fixtureId("payoutMethod", 2)}, ${outsider}, 'simulator', 'acct_outsider', 'GB', 'GBP', 'active', ${now}, ${now}, ${now})`.execute(
        world.db,
      );
      const insert = (reservationKey: string) =>
        sql`insert into payouts (id, batch_id, publisher_id, method_id, currency, amount_minor, reservation_key,
          idempotency_key, state, created_at)
          values (${fixtureId("payout", 98)}, ${batchId}, ${outsider}, ${fixtureId("payoutMethod", 2)}, 'GBP', 100,
            ${reservationKey}, ${crypto.randomUUID()}, 'reserved', ${now})`.execute(world.db);
      await expect(insert("reservation-1")).rejects.toThrow(/not prepared or the publisher is not in its organization/);
      await world.addPublisher({
        organizationId,
        publisherId: fixtureId("publisher", 3),
        methodId: fixtureId("payoutMethod", 3),
        currency: "GBP",
      });
      await expect(
        sql`insert into payouts (id, batch_id, publisher_id, method_id, currency, amount_minor, reservation_key,
          idempotency_key, state, created_at)
          values (${fixtureId("payout", 97)}, ${batchId}, ${fixtureId("publisher", 3)}, ${fixtureId("payoutMethod", 3)}, 'GBP', 100,
            'another-key-1', ${crypto.randomUUID()}, 'reserved', ${now})`.execute(world.db),
      ).rejects.toThrow(/payouts_batch_key_fk/);
    });
  });

  test("the database refuses a second batch with the same reservation key in one organization, and a payout in a cancelled batch", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      const insertBatch = (id: string, organization: string) =>
        sql`insert into payout_batches (id, organization_id, reservation_key, currency, period_start, period_end, state,
          policy_version, created_by, created_at)
          values (${id}, ${organization}, 'reservation-1', 'GBP', ${new Date("2026-10-01T00:00:00.000Z")},
            ${new Date("2026-10-31T00:00:00.000Z")}, 'prepared', 1, ${userId}, ${now})`.execute(world.db);
      await expect(insertBatch(fixtureId("payoutBatch", 50), organizationId)).rejects.toThrow(
        /payout_batches_reservation_key_uq/,
      );
      // The same key in another organization is a different reservation.
      await insertBatch(fixtureId("payoutBatch", 51), otherOrganizationId);

      await world.store.cancel({
        organizationId,
        batchId,
        at: now,
        audit: { id: fixtureId("audit", 60), actor: { type: "user", id: userId }, occurredAt: now },
      });
      const publisherId = fixtureId("publisher", 4);
      await world.addPublisher({
        organizationId,
        publisherId,
        methodId: fixtureId("payoutMethod", 4),
        currency: "GBP",
      });
      await expect(
        sql`insert into payouts (id, batch_id, publisher_id, method_id, currency, amount_minor, reservation_key,
          idempotency_key, state, created_at)
          values (${fixtureId("payout", 96)}, ${batchId}, ${publisherId}, ${fixtureId("payoutMethod", 4)}, 'GBP', 100,
            'reservation-1', ${crypto.randomUUID()}, 'reserved', ${now})`.execute(world.db),
      ).rejects.toThrow(/batch is not prepared/);
    });
  });

  test("a line whose method is disabled is skipped and the rest still reserve", async () => {
    await withPostgres(async (world) => {
      const a = fixtureId("publisher", 1);
      const b = fixtureId("publisher", 2);
      for (const n of [1, 2]) {
        await world.addPublisher({
          organizationId,
          publisherId: fixtureId("publisher", n),
          methodId: fixtureId("payoutMethod", n),
          currency: "GBP",
        });
      }
      await sql`update payout_methods set state = 'disabled' where id = ${fixtureId("payoutMethod", 1)}`.execute(
        world.db,
      );
      const line = (n: number) => ({
        payoutId: fixtureId("payout", n),
        publisherId: fixtureId("publisher", n),
        methodId: fixtureId("payoutMethod", n),
        requestedMinor: 5_000n,
        availableMinor: 5_000n,
        minimumMinor: 1_000n,
      });
      const outcome = await world.store.reserve({
        organizationId,
        batchId: fixtureId("payoutBatch", 1),
        reservationKey: "reservation-1",
        currency: "GBP",
        periodStart: new Date("2026-10-01T00:00:00.000Z"),
        periodEnd: new Date("2026-10-31T00:00:00.000Z"),
        capMinor: null,
        policyVersion: 1,
        createdBy: userId,
        createdAt: now,
        lines: [line(1), line(2)],
        audit: { id: fixtureId("audit", 1), actor: { type: "user", id: userId }, occurredAt: now },
      });
      expect(outcome).toMatchObject({
        outcome: "reserved",
        skipped: [{ publisherId: a, reason: "method_unavailable" }],
      });
      if (outcome.outcome === "reserved") expect(outcome.batch.lines.map((l) => l.publisherId)).toEqual([b]);
    });
  });

  test("migration 0023 rolls back and re-applies", async () => {
    await withPostgres(async (world) => {
      const { Migrator } = await import("kysely/migration");
      const migrator = new Migrator({ db: world.db, provider: migrationProvider });
      // Roll back to before 0023: 0023 is the latest, so one step down removes it.
      const down = await migrator.migrateDown();
      expect(down.error).toBeUndefined();
      expect(down.results?.[0]).toMatchObject({ migrationName: "0023_payout_batches", status: "Success" });
      const gone = await sql<{ n: string }>`select count(*)::text as n from information_schema.tables
        where table_schema = current_schema() and table_name in ('payouts', 'payout_batches')`.execute(world.db);
      expect(gone.rows[0]?.n).toBe("0");
      const up = await migrator.migrateToLatest();
      expect(up.error).toBeUndefined();
    });
  });
});
