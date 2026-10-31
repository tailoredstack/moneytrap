import type { ClickObservation, ClickRecordOutcome, ClickStore } from "@moneytrap/app/src/ports/click-store";
import { type Kysely, sql } from "kysely";

// A single insert is atomic, so no explicit transaction is needed. The primary key on dedup_key makes the second insert of
// the same click a no-op, and the returned rows say which case happened.
export function createClickStore(db: Kysely<unknown>): ClickStore {
  return {
    async record(click: ClickObservation): Promise<ClickRecordOutcome> {
      const { rows } = await sql<{ dedup_key: string }>`
        insert into clicks (dedup_key, link_id, occurred_at)
        values (${click.dedupKey}, ${click.linkId}, ${click.occurredAt})
        on conflict (dedup_key) do nothing
        returning dedup_key
      `.execute(db);
      return rows.length === 0 ? "duplicate" : "recorded";
    },
  };
}
