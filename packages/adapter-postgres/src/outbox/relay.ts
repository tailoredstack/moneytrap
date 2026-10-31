import { type Kysely, sql } from "kysely";
import { withTx } from "../transaction";

export interface RelayedEvent {
  id: string;
  topic: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: unknown;
}

export type Publish = (event: RelayedEvent) => Promise<void>;

interface OutboxRow {
  id: string;
  topic: string;
  aggregate_id: string;
  aggregate_version: number;
  payload: unknown;
}

// Publishes one batch of unpublished events in insertion order and marks them published in the
// same transaction. FOR UPDATE SKIP LOCKED lets concurrent relays take disjoint batches (TP-W1-021).
// If publish throws, the transaction rolls back and the whole batch is retried. A crash between
// publish and the commit redelivers the event, so delivery is at-least-once; consumers dedupe
// by event_id (ADR-004). Returns the number of events published.
export async function relayOutboxBatch(db: Kysely<unknown>, publish: Publish, batchSize = 100): Promise<number> {
  return withTx(db, async (tx) => {
    const { rows } = await sql<OutboxRow>`
      select id, topic, aggregate_id, aggregate_version, payload
      from outbox_events
      where published_at is null
      order by created_at, id
      limit ${batchSize}
      for update skip locked
    `.execute(tx);
    for (const row of rows) {
      await publish({
        id: row.id,
        topic: row.topic,
        aggregateId: row.aggregate_id,
        aggregateVersion: row.aggregate_version,
        payload: row.payload,
      });
      await sql`update outbox_events set published_at = now() where id = ${row.id}`.execute(tx);
    }
    return rows.length;
  });
}
