import { describe, expect, test } from "bun:test";
import type { RouteView } from "@moneytrap/app";
import type { Id } from "@moneytrap/domain";
import { FakeRouteCache } from "./route-cache";

// The same ADR-007 rules as the Redis adapter's tests, run against the fake with a controlled clock.
const linkId = "link_fake" as Id<"link">;

function view(version = 1): RouteView {
  return {
    linkId,
    destination: "https://shop.example.com/spring",
    state: "active",
    eligible: true,
    allowedHosts: ["shop.example.com"],
    decision: "allow",
    version,
  };
}

describe("FakeRouteCache follows the ADR-007 rules", () => {
  test("serves a view inside the bound and refuses one at or past three seconds", async () => {
    const cache = new FakeRouteCache();
    await cache.put("tok", view(), cache.now - 2_900);
    expect(await cache.get("tok")).toEqual(view());
    await cache.put("tok", view(), cache.now - 3_000);
    expect(await cache.get("tok")).toBeNull();
  });

  test("refuses a loadedAt in the future", async () => {
    const cache = new FakeRouteCache();
    await cache.put("tok", view(), cache.now + 10_000);
    expect(await cache.get("tok")).toBeNull();
  });

  test("a stalled write is denied by the age bound alone", async () => {
    const cache = new FakeRouteCache();
    const loadedAt = await cache.readServerTime();
    cache.now += 3_100;
    await cache.put("tok", view(1), loadedAt);
    expect(await cache.get("tok")).toBeNull();
  });

  test("a version mismatch forces a miss, and a missing version key does not", async () => {
    const cache = new FakeRouteCache();
    await cache.put("tok", view(1), cache.now);
    expect(await cache.get("tok")).toEqual(view(1));
    await cache.publishVersion(linkId, 2);
    expect(await cache.get("tok")).toBeNull();
  });

  test("publishVersion only moves forward", async () => {
    const cache = new FakeRouteCache();
    await cache.publishVersion(linkId, 3);
    await cache.publishVersion(linkId, 2);
    await cache.put("tok", view(3), cache.now);
    expect(await cache.get("tok")).toEqual(view(3));
  });
});
