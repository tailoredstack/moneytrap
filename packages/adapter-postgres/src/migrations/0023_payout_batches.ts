import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Payout batches and the payouts that reserve funds in them (DM-047, DM-048, WP-7.7). A payout row in state `reserved` is the
// reservation: it holds its amount against the publisher's available balance until the batch is cancelled. The reserve
// transaction locks the publisher row, sums the payouts that still hold funds, and inserts only what is left, so two
// batches over the same funds cannot both take them (CT-022).
//
// A reservation key is unique per organization on the batch and per publisher on the payout, so a re-run with the same key
// finds the batch it already made instead of reserving again (TP-W7-013). Rows are not edited: a batch goes from prepared
// to cancelled once, a payout from reserved to cancelled once, and neither is ever deleted. Approval columns and the
// approved/paid states arrive with WP-7.8 and WP-7.9, which extend the state checks below.
export const payoutBatches: Migration = {
  async up(db: Kysely<unknown>) {
    // A payout must name a method of its own publisher and currency. That needs a key those three columns can reference.
    await db.schema
      .alterTable("payout_methods")
      .addUniqueConstraint("payout_methods_id_publisher_currency_uq", ["id", "publisher_id", "currency"])
      .execute();

    await db.schema
      .createTable("payout_batches")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text", (column) => column.notNull().references("organizations.id"))
      .addColumn("reservation_key", "text", (column) =>
        column.notNull().check(sql`reservation_key ~ '^[A-Za-z0-9_.:-]{8,128}$'`),
      )
      .addColumn("currency", "text", (column) => column.notNull().check(sql`currency ~ '^[A-Z]{3}$'`))
      .addColumn("period_start", "timestamptz", (column) => column.notNull())
      .addColumn("period_end", "timestamptz", (column) => column.notNull())
      .addColumn("state", "text", (column) => column.notNull().check(sql`state in ('prepared', 'cancelled')`))
      // The limited release cap: the most a batch may reserve in total. Null means no cap.
      .addColumn("cap_minor", "bigint", (column) => column.check(sql`cap_minor > 0`))
      // The payout policy version the batch was decided under, so it can be read again under that version (TP-W7-011).
      .addColumn("policy_version", "integer", (column) => column.notNull().check(sql`policy_version >= 1`))
      .addColumn("created_by", "text", (column) => column.notNull().references("user.id"))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("cancelled_at", "timestamptz")
      .addCheckConstraint("payout_batches_period_ck", sql`period_end > period_start`)
      .addCheckConstraint("payout_batches_cancelled_ck", sql`(state = 'cancelled') = (cancelled_at is not null)`)
      .addUniqueConstraint("payout_batches_reservation_key_uq", ["organization_id", "reservation_key"])
      .addUniqueConstraint("payout_batches_id_currency_uq", ["id", "currency"])
      .addUniqueConstraint("payout_batches_id_reservation_key_uq", ["id", "reservation_key"])
      .execute();

    await db.schema
      .createTable("payouts")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("batch_id", "text", (column) => column.notNull())
      .addColumn("publisher_id", "text", (column) => column.notNull().references("publishers.id"))
      .addColumn("method_id", "text", (column) => column.notNull())
      .addColumn("currency", "text", (column) => column.notNull().check(sql`currency ~ '^[A-Z]{3}$'`))
      .addColumn("amount_minor", "bigint", (column) => column.notNull().check(sql`amount_minor > 0`))
      .addColumn("reservation_key", "text", (column) => column.notNull())
      .addColumn("idempotency_key", "text", (column) => column.notNull().unique())
      .addColumn("provider_ref", "text")
      .addColumn("state", "text", (column) => column.notNull().check(sql`state in ('reserved', 'cancelled')`))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("cancelled_at", "timestamptz")
      .addCheckConstraint("payouts_cancelled_ck", sql`(state = 'cancelled') = (cancelled_at is not null)`)
      // The batch and the method must agree with the payout on currency, and the method with it on publisher.
      .addForeignKeyConstraint("payouts_batch_fk", ["batch_id", "currency"], "payout_batches", ["id", "currency"])
      // A payout carries its batch's reservation key, so the two cannot drift apart.
      .addForeignKeyConstraint("payouts_batch_key_fk", ["batch_id", "reservation_key"], "payout_batches", [
        "id",
        "reservation_key",
      ])
      .addForeignKeyConstraint("payouts_method_fk", ["method_id", "publisher_id", "currency"], "payout_methods", [
        "id",
        "publisher_id",
        "currency",
      ])
      .addUniqueConstraint("payouts_publisher_reservation_key_uq", ["publisher_id", "reservation_key"])
      .execute();
    await db.schema.createIndex("payouts_batch_idx").on("payouts").column("batch_id").execute();
    // The reserve transaction sums the payouts that still hold funds for one publisher and currency.
    await db.schema
      .createIndex("payouts_open_idx")
      .on("payouts")
      .columns(["publisher_id", "currency"])
      .where(sql.ref("state"), "<>", "cancelled")
      .execute();

    // The database refuses edits the adapter would not make, so direct SQL cannot rewrite a reservation.
    await sql`create function payout_batches_guard() returns trigger language plpgsql as $$
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
    await sql`create trigger payout_batches_guard before update or delete on payout_batches
      for each row execute function payout_batches_guard()`.execute(db);
    await sql`create trigger payout_batches_no_truncate before truncate on payout_batches
      for each statement execute function payout_batches_guard()`.execute(db);

    await sql`create function payouts_guard() returns trigger language plpgsql as $$
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
    await sql`create trigger payouts_guard before update or delete on payouts
      for each row execute function payouts_guard()`.execute(db);
    await sql`create trigger payouts_no_truncate before truncate on payouts
      for each statement execute function payouts_guard()`.execute(db);
    // A payout is reserved when it is written, whatever path writes it, and its publisher belongs to the batch's organization.
    await sql`create function payouts_insert_guard() returns trigger language plpgsql as $$
      begin
        if new.state <> 'reserved' then raise exception 'payouts are inserted reserved'; end if;
        if not exists (select 1 from payout_batches b join publishers p on p.organization_id = b.organization_id
          where b.id = new.batch_id and p.id = new.publisher_id)
        then raise exception 'payouts: the publisher is not in the batch organization'; end if;
        return new;
      end $$`.execute(db);
    await sql`create trigger payouts_insert before insert on payouts
      for each row execute function payouts_insert_guard()`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`drop function if exists payouts_insert_guard() cascade`.execute(db);
    await sql`drop function if exists payouts_guard() cascade`.execute(db);
    await sql`drop function if exists payout_batches_guard() cascade`.execute(db);
    await db.schema.dropTable("payouts").ifExists().execute();
    await db.schema.dropTable("payout_batches").ifExists().execute();
    await db.schema.alterTable("payout_methods").dropConstraint("payout_methods_id_publisher_currency_uq").execute();
  },
};
