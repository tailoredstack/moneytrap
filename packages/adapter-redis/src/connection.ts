import IORedis from "ioredis";

// The one place the app opens a Redis connection. ioredis connects at once and retries in the background, so this
// runs at boot, not on first use. The server keeps it open for the life of the process.
export function createRedisConnection(url: string): IORedis {
  return new IORedis(url);
}
