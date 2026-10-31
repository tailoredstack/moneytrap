import type { Migration, MigrationProvider } from "kysely/migration";
import { platform } from "./0001_platform";

// Every migration is imported here statically so the compiled binary carries the set and
// reads no files at runtime (ADR-003). Add new entries in filename order.
const migrations: Record<string, Migration> = {
  "0001_platform": platform,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
