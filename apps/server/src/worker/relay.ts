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
  // Each start() gets its own run, and a new loop waits for the previous one to exit. A restart
  // issued while a step is in flight therefore never overlaps the old loop.
  let current: { stopped: boolean } | undefined;
  let tail: Promise<void> = Promise.resolve();

  const step = () => relayOutboxBatch(db, publish, batchSize);

  const loopUntilStopped = async (run: { stopped: boolean }) => {
    while (!run.stopped) {
      let published = 0;
      try {
        published = await step();
      } catch (error) {
        console.error("outbox relay step failed", error);
      }
      if (published === 0 && !run.stopped) await Bun.sleep(idleMs);
    }
  };

  return {
    step,
    start() {
      if (current && !current.stopped) return;
      const run = { stopped: false };
      current = run;
      tail = tail.then(() => loopUntilStopped(run));
    },
    async stop() {
      if (current) {
        current.stopped = true;
        current = undefined;
      }
      await tail;
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
