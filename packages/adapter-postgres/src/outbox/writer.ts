import { sql, type Transaction } from "kysely";

export interface OutboxEvent {
  id: string;
  topic: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: unknown;
}

// Call inside the same transaction as the state change, so both commit or neither does (ADR-004).
// clock_timestamp() rather than now(): now() is the transaction start, so two events written in
// one transaction would tie on created_at and the relay could not keep their order.
export async function appendOutboxEvent(tx: Transaction<unknown>, event: OutboxEvent): Promise<void> {
  await sql`
    insert into outbox_events (id, topic, aggregate_id, aggregate_version, payload, created_at)
    values (${event.id}, ${event.topic}, ${event.aggregateId}, ${event.aggregateVersion}, ${JSON.stringify(event.payload)}::jsonb, clock_timestamp())
  `.execute(tx);
}
