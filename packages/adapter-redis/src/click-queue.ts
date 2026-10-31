import type { ClickObservation, ClickQueue } from "@moneytrap/app";
import { Queue } from "bullmq";
import type IORedis from "ioredis";

// The job carries the observation as JSON, so the instant travels as an ISO string. The consumer rebuilds the Date.
export interface ClickJob {
  dedupKey: string;
  linkId: string;
  occurredAt: string;
}

// BullMQ on ioredis, the same client the outbox queue uses (ADR-004). The job id is the dedup key, so a click enqueued
// twice while its job is still queued adds one job. Completed jobs are removed, so the queue does not grow without bound.
// The consumer still dedupes through the click store's primary key.
export function createClickQueue(connection: IORedis, queueName = "clicks"): ClickQueue & { close(): Promise<void> } {
  const queue = new Queue<ClickJob>(queueName, { connection });
  return {
    async enqueue(click: ClickObservation) {
      const job: ClickJob = {
        dedupKey: click.dedupKey,
        linkId: click.linkId,
        occurredAt: click.occurredAt.toISOString(),
      };
      await queue.add("click", job, { jobId: click.dedupKey, removeOnComplete: true });
    },
    async close() {
      await queue.close();
    },
  };
}
