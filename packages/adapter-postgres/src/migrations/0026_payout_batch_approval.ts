import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Maker-checker approval of a payout batch (DM-047, WP-7.8). A batch goes from prepared to approved once, by a user other than
// the one who prepared it, and its reserved payouts go to approved with it. The approver and the time are columns of the
// batch, and the approval is one audit row, so the record is the same wherever it is read.
//
// The database refuses what the adapter would not do, so direct SQL cannot approve a batch twice, approve a cancelled one,
// let the preparer approve, or edit an approval afterwards. Rows are still never deleted. Cancelling stays a move out of
// prepared only: an approved batch is past the point where a cancel frees its funds (dispatch and its failures are WP-7.9).
export const payoutBatchApproval: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table payout_batches drop constraint payout_batches_state_check`.execute(db);
    await sql`alter table payout_batches add constraint payout_batches_state_check
      check (state in ('prepared', 'approved', 'cancelled'))`.execute(db);
    await db.schema
      .alterTable("payout_batches")
      .addColumn("approved_by", "text", (column) => column.references("user.id"))
      .addColumn("approved_at", "timestamptz")
      .execute();
    // Both approval columns are set together and only on an approved batch. The approver is never the preparer.
    await sql`alter table payout_batches
      add constraint payout_batches_approved_ck
        check ((state = 'approved') = (approved_by is not null and approved_at is not null)
          and (approved_by is null) = (approved_at is null)),
      add constraint payout_batches_maker_checker_ck check (approved_by is null or approved_by <> created_by)`.execute(
      db,
    );

    await sql`alter table payouts drop constraint payouts_state_check`.execute(db);
    await sql`alter table payouts add constraint payouts_state_check
      check (state in ('reserved', 'approved', 'cancelled'))`.execute(db);

    // The approval is one audit row per batch, so a second approval cannot be recorded even by direct SQL.
    await sql`create unique index audit_logs_payout_batch_approved_uq on audit_logs (entity_id)
      where action = 'payout_batch.approved'`.execute(db);

    await sql`create or replace function payout_batches_guard() returns trigger language plpgsql as $$
      begin
        if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'payout_batches rows are never deleted'; end if;
        if old.state <> 'prepared' or new.state not in ('cancelled', 'approved')
          or (new.id, new.organization_id, new.reservation_key, new.currency, new.period_start, new.period_end,
              new.cap_minor, new.policy_version, new.created_by, new.created_at)
            is distinct from (old.id, old.organization_id, old.reservation_key, old.currency, old.period_start,
              old.period_end, old.cap_minor, old.policy_version, old.created_by, old.created_at)
        then raise exception 'payout_batches may only be cancelled or approved once'; end if;
        if new.state = 'cancelled' and (new.cancelled_at is null or new.approved_by is not null) then
          raise exception 'payout_batches may only be cancelled once';
        end if;
        if new.state = 'approved' and (new.cancelled_at is not null or new.approved_by is null
          or new.approved_by = new.created_by)
        then raise exception 'payout_batches may only be approved once, by a user other than the preparer'; end if;
        return new;
      end $$`.execute(db);

    await sql`create or replace function payouts_guard() returns trigger language plpgsql as $$
      begin
        if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'payouts rows are never deleted'; end if;
        if old.state <> 'reserved' or new.state not in ('cancelled', 'approved')
          or (new.id, new.batch_id, new.publisher_id, new.method_id, new.currency, new.amount_minor,
              new.reservation_key, new.idempotency_key, new.provider_ref, new.created_at)
            is distinct from (old.id, old.batch_id, old.publisher_id, old.method_id, old.currency, old.amount_minor,
              old.reservation_key, old.idempotency_key, old.provider_ref, old.created_at)
          or (new.state = 'cancelled') <> (new.cancelled_at is not null)
        then raise exception 'payouts may only be cancelled or approved once'; end if;
        -- A payout is approved only with its batch, and cancelled only while its batch is still prepared: an approved batch
        -- keeps its funds, so a cancel cannot free them.
        if new.state = 'approved' and not exists (select 1 from payout_batches b
          where b.id = new.batch_id and b.state = 'approved')
        then raise exception 'payouts: the batch is not approved'; end if;
        if new.state = 'cancelled' and not exists (select 1 from payout_batches b
          where b.id = new.batch_id and b.state = 'prepared')
        then raise exception 'payouts: a payout is cancelled only while its batch is prepared'; end if;
        return new;
      end $$`.execute(db);

    // A batch cannot be approved while any of its payouts is still reserved. The check runs at commit, so the approval and the
    // payout updates can be made in one transaction in either order. Direct SQL that approves the batch alone is refused here.
    await sql`create function payout_batches_approved_guard() returns trigger language plpgsql as $$
      begin
        if exists (select 1 from payouts p where p.batch_id = new.id and p.state = 'reserved')
        then raise exception 'payout_batches: an approved batch still has reserved payouts'; end if;
        return null;
      end $$`.execute(db);
    await sql`create constraint trigger payout_batches_approved_ct after update on payout_batches
      deferrable initially deferred for each row when (new.state = 'approved')
      execute function payout_batches_approved_guard()`.execute(db);
  },

  // Restores the prepared/cancelled rules. It fails while an approved batch exists, because its rows cannot be put back.
  async down(db: Kysely<unknown>) {
    await sql`drop trigger if exists payout_batches_approved_ct on payout_batches`.execute(db);
    await sql`drop function if exists payout_batches_approved_guard() cascade`.execute(db);
    // Approved rows cannot be put back into the old state checks, and approval history must not be dropped with the columns.
    // Refusing here, before any change, leaves the schema as it was whether or not the migrator wraps the run in a transaction.
    const approved = await sql<{
      n: string;
    }>`select count(*)::text as n from payout_batches where state = 'approved'`.execute(db);
    if (approved.rows[0]?.n !== "0") {
      throw new Error("0026_payout_batch_approval cannot roll back while approved payout batches exist");
    }
    await sql`drop index if exists audit_logs_payout_batch_approved_uq`.execute(db);
    await sql`create or replace function payouts_guard() returns trigger language plpgsql as $$
      begin
        if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'payouts rows are never deleted'; end if;
        if old.state <> 'reserved' or new.state <> 'cancelled' or new.cancelled_at is null
          or (new.id, new.batch_id, new.publisher_id, new.method_id, new.currency, new.amount_minor,
              new.reservation_key, new.idempotency_key, new.provider_ref, new.created_at)
            is distinct from (old.id, old.batch_id, old.publisher_id, old.method_id, old.currency, old.amount_minor,
              old.reservation_key, old.idempotency_key, old.provider_ref, old.created_at)
        then raise exception 'payouts may only be cancelled once'; end if;
        return new;
      end $$`.execute(db);
    await sql`create or replace function payout_batches_guard() returns trigger language plpgsql as $$
      begin
        if tg_op in ('DELETE', 'TRUNCATE') then raise exception 'payout_batches rows are never deleted'; end if;
        if old.state <> 'prepared' or new.state <> 'cancelled' or new.cancelled_at is null
          or (new.id, new.organization_id, new.reservation_key, new.currency, new.period_start, new.period_end,
              new.cap_minor, new.policy_version, new.created_by, new.created_at)
            is distinct from (old.id, old.organization_id, old.reservation_key, old.currency, old.period_start,
              old.period_end, old.cap_minor, old.policy_version, old.created_by, old.created_at)
        then raise exception 'payout_batches may only be cancelled once'; end if;
        return new;
      end $$`.execute(db);
    await sql`alter table payouts drop constraint payouts_state_check`.execute(db);
    await sql`alter table payouts add constraint payouts_state_check check (state in ('reserved', 'cancelled'))`.execute(
      db,
    );
    await sql`alter table payout_batches drop constraint payout_batches_maker_checker_ck,
      drop constraint payout_batches_approved_ck`.execute(db);
    await db.schema.alterTable("payout_batches").dropColumn("approved_at").dropColumn("approved_by").execute();
    await sql`alter table payout_batches drop constraint payout_batches_state_check`.execute(db);
    await sql`alter table payout_batches add constraint payout_batches_state_check
      check (state in ('prepared', 'cancelled'))`.execute(db);
  },
};
