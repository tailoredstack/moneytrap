import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Networks and their accounts (DM-014, DM-016, WP-4.4). A credential is stored only as sealed ciphertext with the ID of
// the key that sealed it (spec §4.4). Nothing in this table holds the plaintext, so reading the row cannot reveal it.
export const networks: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("networks")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("code", "text", (column) => column.notNull().unique())
      .addColumn("name", "text", (column) => column.notNull())
      .addColumn("capabilities", "jsonb", (column) => column.notNull().defaultTo(sql`'{}'::jsonb`))
      .addColumn("enabled", "boolean", (column) => column.notNull().defaultTo(true))
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .execute();

    // 0004 stored network_id before this table existed. The reference is enforced now that the parent exists.
    await db.schema
      .alterTable("network_advertisers")
      .addForeignKeyConstraint("network_advertisers_network_fk", ["network_id"], "networks", ["id"])
      .execute();

    await db.schema
      .createTable("network_accounts")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("network_id", "text", (column) => column.notNull().references("networks.id"))
      .addColumn("account_ref", "text", (column) => column.notNull())
      .addColumn("state", "text", (column) => column.notNull())
      .addColumn("last_checked_at", "timestamptz")
      .addColumn("credential_ciphertext", "text", (column) => column.notNull())
      .addColumn("credential_key_id", "text", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull())
      .addColumn("updated_at", "timestamptz", (column) => column.notNull())
      .addUniqueConstraint("network_accounts_network_ref_uq", ["network_id", "account_ref"])
      .execute();
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("network_accounts").ifExists().execute();
    await db.schema.alterTable("network_advertisers").dropConstraint("network_advertisers_network_fk").execute();
    await db.schema.dropTable("networks").ifExists().execute();
  },
};
