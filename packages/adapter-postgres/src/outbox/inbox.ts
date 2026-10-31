import { type Kysely, sql, type Transaction } from "kysely";
import { withTx } from "../transaction";

// Runs handle at most once per (consumer, eventId). The dedupe row and the effect share one
// transaction, so a crash either keeps both or drops both and the redelivery runs the effect (DM-057).
// Returns false when the event was already processed.
export async function consumeOnce(
  db: Kysely<unknown>,
  consumer: string,
  eventId: string,
  handle: (tx: Transaction<unknown>) => Promise<void>,
): Promise<boolean> {
  return withTx(db, async (tx) => {
    const inserted = await sql`
      insert into inbox_processed_events (id, consumer, event_id)
      values (${`${consumer}:${eventId}`}, ${consumer}, ${eventId})
      on conflict (consumer, event_id) do nothing
      returning id
    `.execute(tx);
    if (inserted.rows.length === 0) return false;
    await handle(tx);
    return true;
  });
}
