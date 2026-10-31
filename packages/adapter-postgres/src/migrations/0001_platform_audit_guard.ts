import { type Kysely, sql } from "kysely";
import type { Migration } from "kysely/migration";

// Separate from 0001_platform so databases that already applied the baseline gain the guard.
export const platformAuditGuard: Migration = {
  async up(db: Kysely<unknown>) {
    // Reject ordinary mutations even when the connection owns the table. Production connections
    // should still use a restricted role; the trigger protects against accidental owner writes.
    await sql`create function audit_logs_reject_mutation() returns trigger language plpgsql as $$
      begin
        raise exception 'audit_logs is append-only';
      end;
    $$`.execute(db);
    await sql`create trigger audit_logs_append_only before update or delete on audit_logs
      for each row execute function audit_logs_reject_mutation()`.execute(db);
    await sql`create trigger audit_logs_no_truncate before truncate on audit_logs
      for each statement execute function audit_logs_reject_mutation()`.execute(db);
  },

  async down(db: Kysely<unknown>) {
    await sql`drop trigger audit_logs_append_only on audit_logs`.execute(db);
    await sql`drop trigger audit_logs_no_truncate on audit_logs`.execute(db);
    await sql`drop function audit_logs_reject_mutation()`.execute(db);
  },
};
