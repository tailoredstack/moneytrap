import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Platform baseline: idempotency (DM-053), transactional outbox (DM-056), inbox dedupe (DM-057),
// and the append-only audit log (DM-059).
//
// organization_id columns are plain text here. Their foreign keys to organizations.id are added
// with the identity migration (0002), because organizations does not exist yet.
//
// The audit role is the only role the app uses to write audit rows. It may insert and read them,
// but never update or delete (Blueprint §5; spec §4.4).
export const AUDIT_ROLE = "moneytrap_audit";

export const platform: Migration = {
  async up(db: Kysely<unknown>) {
    await db.schema
      .createTable("idempotency_requests")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text", (column) => column.notNull())
      .addColumn("scope", "text", (column) => column.notNull())
      .addColumn("key_hash", "text", (column) => column.notNull())
      .addColumn("request_hash", "text", (column) => column.notNull())
      .addColumn("response_status", "integer")
      .addColumn("response_body", "jsonb")
      .addColumn("expires_at", "timestamptz", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint("idempotency_requests_org_scope_key_uq", ["organization_id", "scope", "key_hash"])
      .execute();

    await db.schema
      .createTable("outbox_events")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("topic", "text", (column) => column.notNull())
      .addColumn("aggregate_id", "text", (column) => column.notNull())
      .addColumn("aggregate_version", "integer", (column) => column.notNull())
      .addColumn("payload", "jsonb", (column) => column.notNull())
      .addColumn("created_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addColumn("published_at", "timestamptz")
      .addUniqueConstraint("outbox_events_topic_aggregate_version_uq", ["topic", "aggregate_id", "aggregate_version"])
      .execute();

    await db.schema
      .createTable("inbox_processed_events")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("consumer", "text", (column) => column.notNull())
      .addColumn("event_id", "text", (column) => column.notNull())
      .addColumn("processed_at", "timestamptz", (column) => column.notNull().defaultTo(sql`now()`))
      .addUniqueConstraint("inbox_processed_events_consumer_event_uq", ["consumer", "event_id"])
      .execute();

    await db.schema
      .createTable("audit_logs")
      .addColumn("id", "text", (column) => column.primaryKey())
      .addColumn("organization_id", "text")
      .addColumn("actor_type", "text", (column) => column.notNull())
      .addColumn("actor_id", "text")
      .addColumn("action", "text", (column) => column.notNull())
      .addColumn("entity_type", "text", (column) => column.notNull())
      .addColumn("entity_id", "text", (column) => column.notNull())
      .addColumn("before_hash", "text")
      .addColumn("after_hash", "text")
      .addColumn("metadata", "jsonb", (column) => column.notNull())
      .addColumn("occurred_at", "timestamptz", (column) => column.notNull())
      .execute();

    // NOLOGIN group role, created once per cluster. Re-running the migration leaves it alone.
    // AUDIT_ROLE is a constant, so inlining it into the DO body is safe. Parameters do not bind there.
    await sql
      .raw(
        `do $$ begin
          if not exists (select 1 from pg_roles where rolname = '${AUDIT_ROLE}') then
            create role "${AUDIT_ROLE}" nologin;
          end if;
        end $$`,
      )
      .execute(db);
    await sql`grant select, insert on table audit_logs to ${sql.id(AUDIT_ROLE)}`.execute(db);
    await sql`revoke update, delete, truncate on table audit_logs from ${sql.id(AUDIT_ROLE)}`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await db.schema.dropTable("audit_logs").execute();
    await db.schema.dropTable("inbox_processed_events").execute();
    await db.schema.dropTable("outbox_events").execute();
    await db.schema.dropTable("idempotency_requests").execute();
    await sql`drop role if exists ${sql.id(AUDIT_ROLE)}`.execute(db);
  },
};
