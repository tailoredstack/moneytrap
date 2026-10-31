import type { Kysely } from "kysely";
import { type MigrationProvider, type MigrationResultSet, Migrator } from "kysely/migration";
import { migrationProvider as staticMigrations } from "./migrations";

// Applies every pending migration in name order. Kysely records applied names in its own
// table, so a second run finds nothing pending and changes nothing (ADR-003).
export async function migrate(
  db: Kysely<unknown>,
  provider: MigrationProvider = staticMigrations,
): Promise<MigrationResultSet> {
  const migrator = new Migrator({ db, provider });
  const result = await migrator.migrateToLatest();
  if (result.error) throw result.error;
  return result;
}
