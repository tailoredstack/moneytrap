import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Payout methods enrolled through the provider-hosted flow (DM-046, WP-7.5). The row holds the provider's reference and
// nothing about the account behind it. A provider account reference is unique per provider. The check constraints keep a
// raw account number out of the reference column, so a value that is not a reference cannot be stored.
export const payoutMethods: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("payout_methods")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("publisher_id", "text", (column) => column.notNull().references("publishers.id"))
      .addColumn("provider", "text", (column) => column.notNull().check(sql`provider ~ '^[a-z][a-z0-9_]{1,31}$'`))
      .addColumn("provider_account_ref", "text", (column) =>
        column.notNull().check(sql`provider_account_ref ~ '^[A-Za-z0-9_.:-]{1,128}$'`),
      )
      .addColumn("country", "text", (column) => column.notNull().check(sql`country ~ '^[A-Z]{2}$'`))
      .addColumn("currency", "text", (column) => column.notNull().check(sql`currency ~ '^[A-Z]{3}$'`))
      .addColumn("state", "text", (column) => column.notNull().check(sql`state in ('active', 'disabled')`))
      .addColumn("verified_at", "timestamptz")
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addCheckConstraint("payout_methods_verified_ck", sql`state <> 'active' or verified_at is not null`)
      .addUniqueConstraint("payout_methods_provider_ref_uq", ["provider", "provider_account_ref"])
      .execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("payout_methods").execute();
  },
};
