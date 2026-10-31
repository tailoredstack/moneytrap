import IORedis from "ioredis";

// The one place the app opens a Redis connection. Callers own it and close it on shutdown.
export function createRedisConnection(url: string): IORedis {
  return new IORedis(url);
}
