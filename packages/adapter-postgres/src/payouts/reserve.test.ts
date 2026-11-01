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
const checkerId = fixtureId("user", 2);

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
    values (${userId}, 'Finance', 'finance@example.com', true, ${now}, ${now}),
      (${checkerId}, 'Checker', 'checker@example.com', true, ${now}, ${now})`.execute(db);
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
    checkerId,
    async addPublisher(input: {
      organizationId: string;
      publisherId: string;
      methodId: string;
      currency: string;
      status?: string;
    }) {
      await sql`insert into publishers (id, legal_name, status, organization_id, created_at, updated_at)
        values (${input.publisherId}, ${input.publisherId}, ${input.status ?? "approved"}, ${input.organizationId}, ${now}, ${now})`.execute(
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
      ).rejects.toThrow(/may only be cancelled or approved once/);
      await expect(sql`delete from payouts where id = ${payoutId}`.execute(world.db)).rejects.toThrow(/never deleted/);
      await expect(sql`delete from payout_batches where id = ${batchId}`.execute(world.db)).rejects.toThrow(
        /never deleted/,
      );
      await expect(sql`truncate payouts`.execute(world.db)).rejects.toThrow(/never deleted/);
      await sql`update payouts set state = 'cancelled', cancelled_at = ${now} where id = ${payoutId}`.execute(world.db);
      await expect(
        sql`update payouts set state = 'reserved', cancelled_at = null where id = ${payoutId}`.execute(world.db),
      ).rejects.toThrow(/may only be cancelled or approved once/);
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

  const approvalInput = (batchId: string, approver: string, n: number) => ({
    organizationId,
    batchId: batchId as ReturnType<typeof fixtureId<"payoutBatch">>,
    approver: approver as ReturnType<typeof fixtureId<"user">>,
    at: new Date("2026-11-02T09:30:00.000Z"),
    availability: [{ publisherId: fixtureId("publisher", 1), availableMinor: 5_000n }],
    audit: {
      id: fixtureId("audit", n),
      actor: { type: "user" as const, id: approver as ReturnType<typeof fixtureId<"user">> },
      occurredAt: new Date("2026-11-02T09:30:00.000Z"),
    },
  });

  test("an approval writes the batch, its payouts, and one audit row naming both people together (TP-W7-017)", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      const outcome = await world.store.approve(approvalInput(batchId, checkerId, 70));
      expect(outcome.outcome).toBe("approved");

      const batch = await sql<{ state: string; approved_by: string; approved_at: Date }>`
        select state, approved_by, approved_at from payout_batches where id = ${batchId}`.execute(world.db);
      expect(batch.rows[0]).toMatchObject({ state: "approved", approved_by: checkerId });
      expect(batch.rows[0]?.approved_at.toISOString()).toBe("2026-11-02T09:30:00.000Z");
      const payouts = await sql<{ state: string }>`select state from payouts where batch_id = ${batchId}`.execute(
        world.db,
      );
      expect(payouts.rows.map((row) => row.state)).toEqual(["approved"]);

      const audits = await sql<{ actor_id: string; metadata: Record<string, unknown>; occurred_at: Date }>`
        select actor_id, metadata, occurred_at from audit_logs
        where entity_id = ${batchId} and action = 'payout_batch.approved'`.execute(world.db);
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.actor_id).toBe(checkerId);
      expect(audits.rows[0]?.occurred_at.toISOString()).toBe("2026-11-02T09:30:00.000Z");
      expect(audits.rows[0]?.metadata).toMatchObject({
        preparedBy: userId,
        approvedBy: checkerId,
        approvedAt: "2026-11-02T09:30:00.000Z",
        payoutCount: 1,
        totalMinor: "5000",
      });
    });
  });

  test("a refused self-approval changes nothing and is itself audited (TP-W7-016, TP-W7-049, CT-025)", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      const outcome = await world.store.approve(approvalInput(batchId, userId, 71));
      expect(outcome).toEqual({ outcome: "refused", reason: "self_approval" });
      const batch = await sql<{ state: string; approved_by: string | null }>`
        select state, approved_by from payout_batches where id = ${batchId}`.execute(world.db);
      expect(batch.rows[0]).toEqual({ state: "prepared", approved_by: null });
      const audits = await sql<{ action: string; actor_id: string; metadata: Record<string, unknown> }>`
        select action, actor_id, metadata from audit_logs where entity_id = ${batchId} order by occurred_at, action`.execute(
        world.db,
      );
      expect(audits.rows.map((row) => row.action)).toEqual(["payout_batch.prepared", "payout_batch.approval_denied"]);
      const denied = audits.rows.find((row) => row.action === "payout_batch.approval_denied");
      expect(denied?.actor_id).toBe(userId);
      expect(denied?.metadata).toMatchObject({ preparedBy: userId, attemptedBy: userId, reason: "self_approval" });
    });
  });

  test("a second approval and an approval after cancel write nothing (TP-W7-048)", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      await world.store.approve(approvalInput(batchId, checkerId, 72));
      expect(await world.store.approve(approvalInput(batchId, checkerId, 73))).toEqual({
        outcome: "refused",
        reason: "already_approved",
      });
      const repeated = await sql<{ actor_id: string; metadata: Record<string, unknown> }>`
        select actor_id, metadata from audit_logs where entity_id = ${batchId} and action = 'payout_batch.approval_denied'`.execute(
        world.db,
      );
      expect(repeated.rows).toHaveLength(1);
      expect(repeated.rows[0]?.actor_id).toBe(checkerId);
      expect(repeated.rows[0]?.metadata.reason).toBe("already_approved");

      const second = await reserveOne(world, 2);
      await world.store.cancel({
        organizationId,
        batchId: second.batchId,
        at: now,
        audit: { id: fixtureId("audit", 74), actor: { type: "user", id: userId }, occurredAt: now },
      });
      expect(await world.store.approve(approvalInput(second.batchId, checkerId, 75))).toEqual({
        outcome: "refused",
        reason: "cancelled",
      });
      const cancelled = await sql<{ actor_id: string; metadata: Record<string, unknown> }>`
        select actor_id, metadata from audit_logs where entity_id = ${second.batchId} and action = 'payout_batch.approval_denied'`.execute(
        world.db,
      );
      expect(cancelled.rows).toHaveLength(1);
      expect(cancelled.rows[0]?.actor_id).toBe(checkerId);
      expect(cancelled.rows[0]?.metadata.reason).toBe("cancelled");
    });
  });

  test("the database refuses an approval by the preparer, a second approval, and an edit of an approved batch (TP-W7-051)", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      await expect(
        sql`update payout_batches set state = 'approved', approved_by = ${userId}, approved_at = ${now}
          where id = ${batchId}`.execute(world.db),
      ).rejects.toThrow(/payout_batches_maker_checker_ck|approved once/);
      await expect(
        sql`update payout_batches set state = 'approved' where id = ${batchId}`.execute(world.db),
      ).rejects.toThrow(/other than the preparer/);
      await expect(
        sql`update payout_batches set approved_by = ${checkerId}, approved_at = ${now} where id = ${batchId}`.execute(
          world.db,
        ),
      ).rejects.toThrow();

      await world.store.approve(approvalInput(batchId, checkerId, 76));
      const rewrite = (set: ReturnType<typeof sql>) =>
        sql`update payout_batches set ${set} where id = ${batchId}`.execute(world.db);
      await expect(
        rewrite(sql`state = 'cancelled', cancelled_at = ${now}, approved_by = null, approved_at = null`),
      ).rejects.toThrow(/may only be cancelled or approved once/);
      await expect(rewrite(sql`approved_by = ${userId}`)).rejects.toThrow();
      await expect(rewrite(sql`approved_at = ${now}`)).rejects.toThrow(/may only be cancelled or approved once/);
    });
  });

  test("the database refuses a payout approved without an approved batch, an approved payout edited, and a duplicate approval audit row", async () => {
    await withPostgres(async (world) => {
      const { batchId, payoutId } = await reserveOne(world);
      await expect(sql`update payouts set state = 'approved' where id = ${payoutId}`.execute(world.db)).rejects.toThrow(
        /batch is not approved/,
      );
      await world.store.approve(approvalInput(batchId, checkerId, 77));
      await expect(
        sql`update payouts set state = 'cancelled', cancelled_at = ${now} where id = ${payoutId}`.execute(world.db),
      ).rejects.toThrow(/may only be cancelled or approved once/);
      await expect(sql`update payouts set amount_minor = 1 where id = ${payoutId}`.execute(world.db)).rejects.toThrow(
        /may only be cancelled or approved once/,
      );
      await expect(
        sql`insert into audit_logs (id, organization_id, actor_type, actor_id, action, entity_type, entity_id, metadata, occurred_at)
          values (${fixtureId("audit", 78)}, ${organizationId}, 'user', ${checkerId}, 'payout_batch.approved', 'payout_batch',
            ${batchId}, '{}'::jsonb, ${now})`.execute(world.db),
      ).rejects.toThrow(/audit_logs_payout_batch_approved_uq/);
    });
  });

  test("an approval is stopped when available no longer covers what is held, and nothing is written (TP-W7-014)", async () => {
    await withPostgres(async (world) => {
      const { batchId, publisherId } = await reserveOne(world);
      const outcome = await world.store.approve({ ...approvalInput(batchId, checkerId, 79), availability: [] });
      expect(outcome).toEqual({ outcome: "insufficient_funds", publisherIds: [publisherId] });
      const batch = await sql<{ state: string }>`select state from payout_batches where id = ${batchId}`.execute(
        world.db,
      );
      expect(batch.rows[0]?.state).toBe("prepared");
      const audits = await sql<{ actor_id: string; metadata: Record<string, unknown> }>`
        select actor_id, metadata from audit_logs where entity_id = ${batchId} and action = 'payout_batch.approval_blocked'`.execute(
        world.db,
      );
      expect(audits.rows).toHaveLength(1);
      expect(audits.rows[0]?.actor_id).toBe(checkerId);
      expect(audits.rows[0]?.metadata).toMatchObject({ reason: "insufficient_funds", attemptedBy: checkerId });
    });
  });

  test("an approved batch cannot be cancelled (TP-W7-050)", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      await world.store.approve(approvalInput(batchId, checkerId, 80));
      const outcome = await world.store.cancel({
        organizationId,
        batchId,
        at: now,
        audit: { id: fixtureId("audit", 81), actor: { type: "user", id: userId }, occurredAt: now },
      });
      expect(outcome).toBe("approved");
    });
  });

  test("migration 0026 refuses to roll back while an approved batch exists, and leaves the schema alone", async () => {
    await withPostgres(async (world) => {
      const { batchId } = await reserveOne(world);
      await world.store.approve(approvalInput(batchId, checkerId, 82));
      const { Migrator } = await import("kysely/migration");
      const migrator = new Migrator({ db: world.db, provider: migrationProvider });
      const down = await migrator.migrateDown();
      expect(String(down.error)).toMatch(/cannot roll back while approved payout batches exist/);
      const batch = await sql<{ state: string; approved_by: string }>`
        select state, approved_by from payout_batches where id = ${batchId}`.execute(world.db);
      expect(batch.rows[0]).toEqual({ state: "approved", approved_by: checkerId });
      const index = await sql`select 1 from pg_indexes where indexname = 'audit_logs_payout_batch_approved_uq'`.execute(
        world.db,
      );
      expect(index.rows).toHaveLength(1);
    });
  });

  test("migrations 0026 through 0023 roll back and re-apply", async () => {
    await withPostgres(async (world) => {
      const { Migrator } = await import("kysely/migration");
      const migrator = new Migrator({ db: world.db, provider: migrationProvider });
      // 0026 is the latest, so it comes off first, then the statement and admin migrations, then 0023.
      const approval = await migrator.migrateDown();
      expect(approval.error).toBeUndefined();
      expect(approval.results?.[0]).toMatchObject({ migrationName: "0026_payout_batch_approval", status: "Success" });
      const columns = await sql<{ n: string }>`select count(*)::text as n from information_schema.columns
        where table_schema = current_schema() and table_name = 'payout_batches' and column_name like 'approved_%'`.execute(
        world.db,
      );
      expect(columns.rows[0]?.n).toBe("0");
      // Roll back newer migrations first, then 0023, and reapply in migration order.
      const latestDown = await migrator.migrateDown();
      expect(latestDown.error).toBeUndefined();
      expect(latestDown.results?.[0]).toMatchObject({
        migrationName: "0025_statement_closed_period",
        status: "Success",
      });
      const restoredStatementConstraint = await sql<{ name: string }>`
        select constraint_name as name from information_schema.table_constraints
        where table_schema = current_schema() and table_name = 'statements'
          and constraint_name = 'statements_period_revision_uq'`.execute(world.db);
      expect(restoredStatementConstraint.rows).toHaveLength(1);
      const adminDown = await migrator.migrateDown();
      expect(adminDown.error).toBeUndefined();
      expect(adminDown.results?.[0]).toMatchObject({ migrationName: "0024_better_auth_admin", status: "Success" });
      const adminColumns = await sql<{ n: string }>`
        select count(*)::text as n from information_schema.columns
        where table_schema = current_schema() and (
          (table_name = 'user' and column_name in ('role', 'banned', 'banReason', 'banExpires')) or
          (table_name = 'session' and column_name = 'impersonatedBy')
        )`.execute(world.db);
      expect(adminColumns.rows[0]?.n).toBe("0");
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
