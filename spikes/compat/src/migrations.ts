import type { Kysely } from "kysely";
import type { Migration, MigrationProvider } from "kysely/migration";

// Statically imported so the compiled binary carries its migrations.
const migrations: Record<string, Migration> = {
  "0001_probe_items": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("probe_items")
        .addColumn("id", "text", (column) => column.primaryKey())
        .addColumn("name", "text", (column) => column.notNull())
        .addColumn("amount", "integer", (column) => column.notNull())
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("probe_items").execute();
    },
  },
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
