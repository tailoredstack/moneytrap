import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Links each publisher to its organization (DM-009, WP-3.3). Nullable so rows created before the link still load;
// the review store treats a publisher without an organization as not found, so no decision can reach it.
export const publisherOrganization: Migration = {
  async up(db: Kysely<unknown>) {
    await sql`alter table publishers add column organization_id text references organizations(id)`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`alter table publishers drop column organization_id`.execute(db);
  },
};
