import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Versioned payout policy and payout holds (DM-045, spec §4.5, WP-7.6). A policy row is never updated or deleted: a change
// publishes the next version, so a decision that named an earlier version can be read again under that version. A hold
// is released by setting released_at once; it is never deleted.
export const payoutPolicy: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("payout_policies")
      .addColumn("currency", "text", (column) => column.notNull())
      .addColumn("version", "integer", (column) => column.notNull().check(sql`version >= 1`))
      .addColumn("minimum_minor", "bigint", (column) => column.notNull().check(sql`minimum_minor >= 0`))
      .addColumn("effective_from", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addPrimaryKeyConstraint("payout_policies_pk", ["currency", "version"])
      .execute();

    await db.schema
      .createTable("payout_holds")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("publisher_id", "text", (column) => column.notNull().references("publishers.id"))
      .addColumn("currency", "text", (column) => column.notNull())
      .addColumn("amount_minor", "bigint", (column) => column.notNull().check(sql`amount_minor > 0`))
      .addColumn("reason", "text", (column) => column.notNull().check(sql`length(trim(reason)) > 0`))
      .addColumn("expires_at", "timestamptz")
      .addColumn("released_at", "timestamptz")
      .addColumn("created_by", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .execute();
    await db.schema
      .createIndex("payout_holds_publisher_idx")
      .on("payout_holds")
      .columns(["publisher_id", "currency"])
      .execute();

    // Immutability is enforced by the database, not only by the adapter (DM-045). A policy row is never changed or removed.
    // A hold may change only once: released_at goes from NULL to a value, and nothing else on it changes.
    await sql`create function payout_policies_immutable() returns trigger language plpgsql as $$
      begin raise exception 'payout_policies rows are immutable'; end $$`.execute(db);
    await sql`create trigger payout_policies_immutable before update or delete on payout_policies
      for each row execute function payout_policies_immutable()`.execute(db);
    await sql`create function payout_holds_guard() returns trigger language plpgsql as $$
      begin
        if tg_op = 'DELETE' then raise exception 'payout_holds rows are never deleted'; end if;
        if old.released_at is not null or new.released_at is null
          or (new.id, new.publisher_id, new.currency, new.amount_minor, new.reason, new.expires_at, new.created_by, new.created_at)
            is distinct from (old.id, old.publisher_id, old.currency, old.amount_minor, old.reason, old.expires_at, old.created_by, old.created_at)
        then raise exception 'payout_holds may only be released once'; end if;
        return new;
      end $$`.execute(db);
    await sql`create trigger payout_holds_guard before update or delete on payout_holds
      for each row execute function payout_holds_guard()`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`drop function if exists payout_holds_guard() cascade`.execute(db);
    await sql`drop function if exists payout_policies_immutable() cascade`.execute(db);
    await db.schema.dropTable("payout_holds").ifExists().execute();
    await db.schema.dropTable("payout_policies").ifExists().execute();
  },
};
