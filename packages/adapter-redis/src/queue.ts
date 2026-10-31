import { Queue } from "bullmq";
import type IORedis from "ioredis";

export interface OutboxMessage {
  id: string;
  topic: string;
  aggregateId: string;
  aggregateVersion: number;
  payload: unknown;
}

export interface OutboxQueue {
  publish(message: OutboxMessage): Promise<void>;
  close(): Promise<void>;
}

// BullMQ runs on ioredis, the only Redis client in production (ADR-004). The job id is the event
// id, so a relay that republishes an event still in the queue adds nothing new. Consumers still
// dedupe by event_id because a job can be removed and then republished.
export function createOutboxQueue(connection: IORedis, queueName = "outbox"): OutboxQueue {
  const queue = new Queue<OutboxMessage>(queueName, { connection });
  return {
    async publish(message) {
      await queue.add(message.topic, message, { jobId: message.id });
    },
    async close() {
      await queue.close();
    },
  };
}
