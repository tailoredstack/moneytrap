import type { Migration, MigrationProvider } from "kysely/migration";
import { platform } from "./0001_platform";
import { platformAuditGuard } from "./0001_platform_audit_guard";
import { betterAuth } from "./0002_better_auth";
import { sessionSecondFactor } from "./0002_session_second_factor";

// Every migration is imported here statically so the compiled binary carries the set and
// reads no files at runtime (ADR-003). Add new entries in filename order.
const migrations: Record<string, Migration> = {
  "0001_platform": platform,
  "0001_platform_audit_guard": platformAuditGuard,
  "0002_better_auth": betterAuth,
  "0002_session_second_factor": sessionSecondFactor,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
