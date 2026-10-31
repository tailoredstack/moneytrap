import { type Publish, relayOutboxBatch } from "@moneytrap/adapter-postgres";
import { createOutboxQueue } from "@moneytrap/adapter-redis";
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
  let stopped = true;
  let loop: Promise<void> | undefined;

  const step = () => relayOutboxBatch(db, publish, batchSize);

  return {
    step,
    start() {
      if (loop) return;
      stopped = false;
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
      const running = loop;
      loop = undefined;
      await running;
    },
  };
}

// Runtime entry point: builds the BullMQ queue from an ioredis connection and runs the relay
// until stop() is called. The server process calls this once it has a database and Redis.
export function startOutboxRelay({
  db,
  connection,
  queueName = "outbox",
  batchSize = 100,
  idleMs = 500,
}: {
  db: Kysely<unknown>;
  connection: Parameters<typeof createOutboxQueue>[0];
  queueName?: string;
  batchSize?: number;
  idleMs?: number;
}) {
  const queue = createOutboxQueue(connection, queueName);
  const relay = createRelay({ db, publish: (message) => queue.publish(message), batchSize, idleMs });
  relay.start();
  return {
    async stop() {
      await relay.stop();
      await queue.close();
    },
  };
}
