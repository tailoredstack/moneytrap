import { describe, expect, test } from "bun:test";
import type { RouteCache, RouteSource, RouteSourceRecord } from "@moneytrap/app";
import { createLink, type Id } from "@moneytrap/domain";
import { FakeClickQueue } from "@moneytrap/test-kit";
import { createApp } from "../app";
import { apiRoutes } from "./routes";

// Auth is replaced with a stub: these tests only exercise the redirect route.
const stubAuth = {
  handler: () => new Response("ok"),
  api: { getSession: async () => null },
} as never;
const clock = { now: () => new Date("2026-11-01T10:00:00.000Z") };
const ids = { next: () => "x" } as never;

const TOKEN = "lnk_01arz3ndektsv4rrffq69g5fav";
const DESTINATION = "https://shop.example.com/spring";

function record(overrides: Partial<RouteSourceRecord["link"]> = {}, eligible = true): RouteSourceRecord {
  const created = createLink({
    id: TOKEN as Id<"link">,
    publisherId: "pub_1" as Id<"publisher">,
    propertyId: "prp_1" as Id<"property">,
    slug: "spring",
    destination: DESTINATION,
    allowedHosts: ["shop.example.com"],
  });
  if (!created.ok) throw new Error("fixture link is invalid");
  return { link: { ...created.value, status: "active", version: 2, ...overrides }, eligible };
}

// No view is cached, so every request reads the source: the answers depend only on what the source says.
function setup(source: RouteSourceRecord | null | "throw", options: { cacheDown?: boolean } = {}) {
  const cache: RouteCache = {
    async readServerTime() {
      return 1_000_000;
    },
    async get() {
      if (options.cacheDown) throw new Error("redis down");
      return null;
    },
    async put() {},
    async publishVersion() {},
  };
  const routeSource: RouteSource = {
    async findByToken() {
      if (source === "throw") throw new Error("postgres down");
      return source;
    },
  };
  const clicks = new FakeClickQueue();
  const app = createApp({ clock, ids, readiness: [] }).use(
    apiRoutes(stubAuth, undefined, undefined, { cache, source: routeSource, clicks, clock, onClickError: () => {} }),
  );
  return { app, clicks };
}

// A settled tick, so the background click enqueue has run before the test reads it.
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("GET /r/:token (UC13, API-043)", () => {
  test("302 to the destination, uncacheable, and one click keyed by the request", async () => {
    const { app, clicks } = setup(record());
    const response = await app.handle(new Request(`http://localhost/r/${TOKEN}`));
    await settle();

    const requestId = response.headers.get("x-request-id");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(DESTINATION);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(clicks.enqueued()).toEqual([
      { dedupKey: `redirect-${requestId}`, linkId: TOKEN as Id<"link">, occurredAt: clock.now() },
    ]);
  });

  test.each([
    ["revoked", record({ status: "revoked" })],
    ["paused", record({ status: "paused" })],
    ["ineligible", record({}, false)],
    ["unknown token", null],
  ])("410 for a %s link, with no Location and no click", async (_name, source) => {
    const { app, clicks } = setup(source);
    const response = await app.handle(new Request(`http://localhost/r/${TOKEN}`));
    await settle();

    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("Gone");
    expect(clicks.enqueued()).toEqual([]);
  });

  test("503 with no Location when the source is down", async () => {
    const { app, clicks } = setup("throw");
    const response = await app.handle(new Request(`http://localhost/r/${TOKEN}`));
    await settle();

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(clicks.enqueued()).toEqual([]);
  });

  test("503 with no Location and no click when the cache and the source are both down", async () => {
    const { app, clicks } = setup("throw", { cacheDown: true });
    const response = await app.handle(new Request(`http://localhost/r/${TOKEN}`));
    await settle();

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
    expect(clicks.enqueued()).toEqual([]);
  });

  test("is not served when the composition root supplies no deps", async () => {
    const app = createApp({ clock, ids, readiness: [] }).use(apiRoutes(stubAuth));
    const response = await app.handle(new Request(`http://localhost/r/${TOKEN}`));
    // Without the route, the shell catch-all answers. It never redirects.
    expect(response.headers.get("location")).toBeNull();
  });
});
