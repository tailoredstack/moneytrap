import { type Publish, relayOutboxBatch } from "@moneytrap/adapter-postgres";
import type { Kysely } from "kysely";

export interface RelayOptions {
  db: Kysely<unknown>;
  publish: Publish;
  batchSize?: number;
  idleMs?: number;
}

// Drains the outbox to the queue. step() publishes one batch and is what tests call; start()
// loops over step() and sleeps idleMs when nothing is pending or a batch failed. Delivery is
// at-least-once (ADR-004), so the queue consumer dedupes by event_id.
export function createRelay({ db, publish, batchSize = 100, idleMs = 500 }: RelayOptions) {
  let stopped = false;
  let loop: Promise<void> | undefined;

  const step = () => relayOutboxBatch(db, publish, batchSize);

  return {
    step,
    start() {
      loop = (async () => {
        while (!stopped) {
          let published = 0;
          try {
            published = await step();
          } catch (error) {
            console.error("outbox relay step failed", error);
          }
          if (published === 0 && !stopped) await Bun.sleep(idleMs);
        }
      })();
    },
    async stop() {
      stopped = true;
      await loop;
    },
  };
}
