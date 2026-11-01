import type { Kysely } from "kysely";
import type { Migration } from "kysely/migration";

// Better Auth admin plugin fields (WP-4.4a). Global role remains separate from organization member roles.
export const betterAuthAdmin: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema.alterTable("user").addColumn("role", "text").execute();
    await db.schema.alterTable("user").addColumn("banned", "boolean").execute();
    await db.schema.alterTable("user").addColumn("banReason", "text").execute();
    await db.schema.alterTable("user").addColumn("banExpires", "timestamptz").execute();
    await db.schema.alterTable("session").addColumn("impersonatedBy", "text").execute();
  },
  async down(db: Kysely<unknown>) {
    await db.schema.alterTable("session").dropColumn("impersonatedBy").execute();
    await db.schema.alterTable("user").dropColumn("banExpires").execute();
    await db.schema.alterTable("user").dropColumn("banReason").execute();
    await db.schema.alterTable("user").dropColumn("banned").execute();
    await db.schema.alterTable("user").dropColumn("role").execute();
  },
};
