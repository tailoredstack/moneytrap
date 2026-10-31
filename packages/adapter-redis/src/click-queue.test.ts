import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createClickQueue } from "./click-queue";

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis("click queue (WP-5.6, WP-5.8)", () => {
  let connection: IORedis;
  let queueName: string;
  let inspector: Queue;

  beforeEach(() => {
    connection = new IORedis(redisUrl as string, { maxRetriesPerRequest: null });
    queueName = `clicks_test_${crypto.randomUUID().replaceAll("-", "")}`;
    inspector = new Queue(queueName, { connection });
  });

  afterEach(async () => {
    await inspector.obliterate({ force: true });
    await inspector.close();
    connection.disconnect();
  });

  test("enqueues the observation as a job keyed by its dedup key", async () => {
    const queue = createClickQueue(connection, queueName);
    try {
      await queue.enqueue({
        dedupKey: "redirect-req-1",
        linkId: "lnk_1",
        occurredAt: new Date("2026-11-01T10:00:00.000Z"),
      });
    } finally {
      await queue.close();
    }

    const job = await inspector.getJob("redirect-req-1");
    expect(job?.name).toBe("click");
    expect(job?.data).toEqual({
      dedupKey: "redirect-req-1",
      linkId: "lnk_1",
      occurredAt: "2026-11-01T10:00:00.000Z",
    });
  });

  test("a repeat of the same dedup key adds one job", async () => {
    const queue = createClickQueue(connection, queueName);
    const click = { dedupKey: "redirect-req-2", linkId: "lnk_1", occurredAt: new Date("2026-11-01T10:00:00.000Z") };
    try {
      await queue.enqueue(click);
      await queue.enqueue(click);
    } finally {
      await queue.close();
    }

    expect(await inspector.getJobCounts("waiting")).toEqual({ waiting: 1 });
  });
});
