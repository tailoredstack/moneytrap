import type { Migration, MigrationProvider } from "kysely/migration";

// Every migration is imported here statically so the compiled binary carries the set and
// reads no files at runtime (ADR-003). Add new entries in filename order.
const migrations: Record<string, Migration> = {};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
