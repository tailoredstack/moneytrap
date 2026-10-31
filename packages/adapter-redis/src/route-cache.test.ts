import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { RouteView } from "@moneytrap/app";
import type { Id } from "@moneytrap/domain";
import IORedis from "ioredis";
import { createRouteCache } from "./route-cache";

const redisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describeWithRedis("route cache", () => {
  let connection: IORedis;
  let token: string;
  let linkId: Id<"link">;

  beforeEach(() => {
    connection = new IORedis(redisUrl as string, { maxRetriesPerRequest: null });
    const unique = crypto.randomUUID().replaceAll("-", "");
    token = `tok_${unique}`;
    linkId = `link_${unique}` as Id<"link">;
  });

  afterEach(async () => {
    await connection.del(`route:view:${token}`, `route:version:${linkId}`);
    connection.disconnect();
  });

  function view(version = 1): RouteView {
    return {
      linkId,
      destination: "https://shop.example.com/spring",
      state: "active",
      eligible: true,
      decision: "allow",
      version,
    };
  }

  test("misses when nothing is cached", async () => {
    expect(await createRouteCache(connection).get(token)).toBeNull();
  });

  test("serves a stored view within three seconds and returns only the route view fields", async () => {
    const cache = createRouteCache(connection);
    const loadedAt = await cache.readServerTime();
    await cache.put(token, view(), loadedAt);
    expect(await cache.get(token)).toEqual(view());
  });

  test("misses a view whose loadedAt is older than three seconds on the Redis clock", async () => {
    const cache = createRouteCache(connection);
    const loadedAt = await cache.readServerTime();
    await sleep(3100);
    await cache.put(token, view(), loadedAt);
    expect(await cache.get(token)).toBeNull();
  });

  test("a stalled write cannot extend a view: the age bound alone denies it (ADR-007 gate)", async () => {
    const cache = createRouteCache(connection);
    // The source read captures the clock and sees an active link.
    const loadedAt = await cache.readServerTime();
    // The cache write stalls past the three-second bound. No version is published, so only the age check can deny it.
    await sleep(3100);
    await cache.put(token, view(1), loadedAt);
    // The stalled, older view must not be served.
    expect(await cache.get(token)).toBeNull();
  });

  test("a view loadedAt in the future is refused", async () => {
    const cache = createRouteCache(connection);
    await cache.put(token, view(), (await cache.readServerTime()) + 10_000);
    expect(await cache.get(token)).toBeNull();
  });

  test("a view just inside the three-second bound is served, and one just outside is not", async () => {
    const cache = createRouteCache(connection);
    const now = await cache.readServerTime();
    await cache.put(token, view(), now - 2_900);
    expect(await cache.get(token)).toEqual(view());
    await cache.put(token, view(), now - 3_100);
    expect(await cache.get(token)).toBeNull();
  });

  test("a version mismatch forces a miss even when the view is fresh", async () => {
    const cache = createRouteCache(connection);
    await cache.put(token, view(1), await cache.readServerTime());
    await cache.publishVersion(linkId, 2);
    expect(await cache.get(token)).toBeNull();
  });

  test("a missing version key does not force a miss on its own", async () => {
    const cache = createRouteCache(connection);
    await cache.put(token, view(1), await cache.readServerTime());
    expect(await connection.exists(`route:version:${linkId}`)).toBe(0);
    expect(await cache.get(token)).toEqual(view(1));
  });

  test("publishVersion only moves forward", async () => {
    const cache = createRouteCache(connection);
    await cache.publishVersion(linkId, 3);
    await cache.publishVersion(linkId, 2);
    expect(await connection.get(`route:version:${linkId}`)).toBe("3");
    await cache.put(token, view(3), await cache.readServerTime());
    expect(await cache.get(token)).toEqual(view(3));
  });

  test("writes never create the version key", async () => {
    const cache = createRouteCache(connection);
    await cache.put(token, view(1), await cache.readServerTime());
    expect(await connection.exists(`route:version:${linkId}`)).toBe(0);
  });

  test("freshness does not depend on the app host clock", async () => {
    const cache = createRouteCache(connection);
    const realNow = Date.now;
    // A host clock far in the past: the Redis clock still decides the view is fresh.
    Date.now = () => 0;
    try {
      const loadedAt = await cache.readServerTime();
      await cache.put(token, view(), loadedAt);
      expect(await cache.get(token)).toEqual(view());
    } finally {
      Date.now = realNow;
    }
  });

  test("the Redis clock is the time source, not the host clock", async () => {
    const cache = createRouteCache(connection);
    const realNow = Date.now;
    Date.now = () => 0;
    try {
      expect(Math.abs((await cache.readServerTime()) - realNow())).toBeLessThan(5000);
    } finally {
      Date.now = realNow;
    }
  });
});
