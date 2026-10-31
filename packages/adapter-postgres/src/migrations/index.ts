import type { Migration, MigrationProvider } from "kysely/migration";
import { platform } from "./0001_platform";
import { platformAuditGuard } from "./0001_platform_audit_guard";
import { betterAuth } from "./0002_better_auth";
import { identity } from "./0003_identity";
import { organization } from "./0003_organization";
import { publisher } from "./0004_publisher";
import { publisherOrganization } from "./0005_publisher_organization";
import { properties } from "./0006_properties";

// Every migration is imported here statically so the compiled binary carries the set and
// reads no files at runtime (ADR-003). Add new entries in filename order.
const migrations: Record<string, Migration> = {
  "0001_platform": platform,
  "0001_platform_audit_guard": platformAuditGuard,
  "0002_better_auth": betterAuth,
  "0003_identity": identity,
  "0003_organization": organization,
  "0004_publisher": publisher,
  "0005_publisher_organization": publisherOrganization,
  "0006_properties": properties,
};

export const migrationProvider: MigrationProvider = {
  async getMigrations() {
    return migrations;
  },
};
