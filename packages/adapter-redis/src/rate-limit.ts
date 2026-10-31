import type IORedis from "ioredis";

export interface RateLimitCounter {
  // Counts one request against key in a fixed window that starts at its first hit, and returns the count.
  increment(key: string, windowSeconds: number): Promise<number>;
  // Reads the live count for key without changing it. Zero when the window has lapsed or was never started.
  count(key: string): Promise<number>;
}

// INCR and EXPIRE NX run in one transaction, so a key never exists without a TTL. NX keeps the window fixed:
// later hits do not extend it. A Redis error rejects instead of allowing the request.
export function createRedisRateLimitCounter(connection: IORedis, prefix = "rate-limit:"): RateLimitCounter {
  return {
    async increment(key, windowSeconds) {
      const redisKey = `${prefix}${key}`;
      const results = await connection.multi().incr(redisKey).expire(redisKey, windowSeconds, "NX").exec();
      if (!results) throw new Error("Rate-limit transaction was aborted");
      const [incrError, count] = results[0] ?? [];
      if (incrError) throw incrError;
      const [expireError] = results[1] ?? [];
      if (expireError) throw expireError;
      return Number(count);
    },
    async count(key) {
      return Number((await connection.get(`${prefix}${key}`)) ?? 0);
    },
  };
}
