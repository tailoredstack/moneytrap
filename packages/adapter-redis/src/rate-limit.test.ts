import { describe, expect, test } from "bun:test";
import type IORedis from "ioredis";
import { createRedisRateLimitCounter } from "./rate-limit";

// A fake that records the commands the counter sends. No Redis server is contacted.
function fakeConnection(results: Array<[Error | null, unknown]> | null, stored: string | null = null) {
  const calls: unknown[][] = [];
  const pipeline = {
    incr(...args: unknown[]) {
      calls.push(["incr", ...args]);
      return pipeline;
    },
    expire(...args: unknown[]) {
      calls.push(["expire", ...args]);
      return pipeline;
    },
    async exec() {
      return results;
    },
  };
  const connection = {
    multi: () => pipeline,
    async get(key: string) {
      calls.push(["get", key]);
      return stored;
    },
  } as unknown as IORedis;
  return { connection, calls };
}

describe("Redis rate-limit counter", () => {
  test("returns the count after incrementing", async () => {
    const { connection } = fakeConnection([
      [null, 3],
      [null, 1],
    ]);
    const counter = createRedisRateLimitCounter(connection);

    expect(await counter.increment("ip:1.2.3.4", 600)).toBe(3);
  });

  test("sets the window only when the key has none, so the window is fixed from the first hit", async () => {
    const { connection, calls } = fakeConnection([
      [null, 1],
      [null, 1],
    ]);
    const counter = createRedisRateLimitCounter(connection, "rl:");

    await counter.increment("identity:login:ada@example.test", 900);

    expect(calls).toEqual([
      ["incr", "rl:identity:login:ada@example.test"],
      ["expire", "rl:identity:login:ada@example.test", 900, "NX"],
    ]);
  });

  test("fails loudly when the Redis transaction errors instead of allowing the request", async () => {
    const { connection } = fakeConnection([
      [new Error("READONLY"), null],
      [null, 1],
    ]);
    const counter = createRedisRateLimitCounter(connection);

    await expect(counter.increment("ip:1.2.3.4", 600)).rejects.toThrow("READONLY");
  });

  test("fails loudly when the transaction is aborted (exec returns null)", async () => {
    const { connection } = fakeConnection(null);
    const counter = createRedisRateLimitCounter(connection);

    await expect(counter.increment("ip:1.2.3.4", 600)).rejects.toThrow();
  });

  test("reads the current count without incrementing it", async () => {
    const { connection, calls } = fakeConnection(null, "4");
    const counter = createRedisRateLimitCounter(connection, "rl:");

    expect(await counter.count("identity:sign-in:ada@example.test")).toBe(4);
    expect(calls).toEqual([["get", "rl:identity:sign-in:ada@example.test"]]);
  });

  test("reads zero for a key that has no live window", async () => {
    const { connection } = fakeConnection(null, null);
    const counter = createRedisRateLimitCounter(connection);

    expect(await counter.count("identity:sign-in:ada@example.test")).toBe(0);
  });
});
