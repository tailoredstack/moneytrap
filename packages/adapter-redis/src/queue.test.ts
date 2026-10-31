import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { createOutboxQueue } from "./queue";

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

describeWithRedis("outbox queue", () => {
  let connection: IORedis;
  let queueName: string;
  let inspector: Queue;

  beforeEach(() => {
    connection = new IORedis(redisUrl as string, { maxRetriesPerRequest: null });
    queueName = `outbox_test_${crypto.randomUUID().replaceAll("-", "")}`;
    inspector = new Queue(queueName, { connection });
  });

  afterEach(async () => {
    await inspector.obliterate({ force: true });
    await inspector.close();
    connection.disconnect();
  });

  test("publishes each event as one job keyed by event_id", async () => {
    const queue = createOutboxQueue(connection, queueName);
    const event = { id: "evt_1", topic: "link.created", aggregateId: "link_1", aggregateVersion: 1, payload: { n: 1 } };
    await queue.publish(event);
    await queue.publish(event);
    await queue.close();
    expect((await inspector.getJobCounts("waiting")).waiting).toBe(1);
    const [job] = await inspector.getJobs(["waiting"]);
    expect(job?.id).toBe("evt_1");
    expect(job?.name).toBe("link.created");
    expect(job?.data).toEqual(event);
  });
});
