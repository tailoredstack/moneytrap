import { describe, expect, test } from "bun:test";
import { createLink, type Id, type Link } from "@moneytrap/domain";
import type { RouteCache } from "../ports/route-cache";
import type { RouteSource, RouteSourceRecord } from "../ports/route-source";
import { buildRouteView, readRouteView } from "./route-view";

const HOSTS = ["shop.example.com"];

function link(overrides: Partial<Link> = {}): Link {
  const created = createLink({
    id: "link_1" as Id<"link">,
    publisherId: "publisher_1" as Id<"publisher">,
    propertyId: "property_1" as Id<"property">,
    slug: "spring",
    destination: "https://shop.example.com/spring",
    allowedHosts: HOSTS,
  });
  if (!created.ok) throw new Error("fixture link is invalid");
  // A fixture link is active at version 2, as after one activation.
  return { ...created.value, status: "active", version: 2, ...overrides };
}

function fakeCache(options: { get?: "throw" | "miss"; time?: "throw"; put?: "throw" } = {}) {
  const calls: string[] = [];
  const cache: RouteCache = {
    async readServerTime() {
      calls.push("time");
      if (options.time === "throw") throw new Error("redis down");
      return 1_000_000;
    },
    async get() {
      calls.push("get");
      if (options.get === "throw") throw new Error("redis down");
      return null;
    },
    async put() {
      calls.push("put");
      if (options.put === "throw") throw new Error("redis down");
    },
    async publishVersion() {},
  };
  return { cache, calls };
}

function fakeSource(record: RouteSourceRecord | null | "throw") {
  const calls: string[] = [];
  const source: RouteSource = {
    async findByToken() {
      calls.push("source");
      if (record === "throw") throw new Error("postgres down");
      return record;
    },
  };
  return { source, calls };
}

describe("buildRouteView", () => {
  test("allows an active link with an eligible property and program", () => {
    expect(buildRouteView(link(), true)).toEqual({
      linkId: "link_1" as Id<"link">,
      destination: "https://shop.example.com/spring",
      state: "active",
      eligible: true,
      decision: "allow",
      version: 2,
    });
  });

  test("denies an active link that is not eligible", () => {
    expect(buildRouteView(link(), false).decision).toBe("deny");
  });

  test("denies paused and revoked links even when eligible", () => {
    expect(buildRouteView(link({ status: "paused" }), true).decision).toBe("deny");
    expect(buildRouteView(link({ status: "revoked" }), true).decision).toBe("deny");
  });

  test("carries the link version so the cache can check it", () => {
    expect(buildRouteView(link({ version: 7 }), true).version).toBe(7);
  });
});

describe("readRouteView", () => {
  test("answers from a fresh cache entry without reading the source", async () => {
    const cached = buildRouteView(link(), true);
    const calls: string[] = [];
    const cache: RouteCache = {
      async readServerTime() {
        return 0;
      },
      async get() {
        calls.push("get");
        return cached;
      },
      async put() {},
      async publishVersion() {},
    };
    const { source, calls: sourceCalls } = fakeSource(null);
    const result = await readRouteView({ cache, source }, "tok");
    expect(result).toEqual({ kind: "found", view: cached });
    expect(calls).toEqual(["get"]);
    expect(sourceCalls).toEqual([]);
  });

  test("reads the cache clock before the source read, then stores the view with that clock value", async () => {
    const order: string[] = [];
    const cache: RouteCache = {
      async readServerTime() {
        order.push("time");
        return 1_000_000;
      },
      async get() {
        order.push("get");
        return null;
      },
      async put(token, view, loadedAt) {
        order.push(`put:${token}:${loadedAt}:${view.decision}`);
      },
      async publishVersion() {},
    };
    const source: RouteSource = {
      async findByToken() {
        order.push("source");
        return { link: link(), eligible: true };
      },
    };
    const result = await readRouteView({ cache, source }, "tok");
    expect(result.kind).toBe("found");
    expect(order).toEqual(["get", "time", "source", "put:tok:1000000:allow"]);
  });

  test("reads the source when the cache throws, and still answers", async () => {
    const { cache } = fakeCache({ get: "throw" });
    const { source, calls } = fakeSource({ link: link(), eligible: true });
    const result = await readRouteView({ cache, source }, "tok");
    expect(result.kind).toBe("found");
    expect(calls).toEqual(["source"]);
  });

  test("answers without storing when the cache clock is unavailable", async () => {
    const { cache, calls: cacheCalls } = fakeCache({ time: "throw" });
    const { source } = fakeSource({ link: link(), eligible: true });
    const result = await readRouteView({ cache, source }, "tok");
    expect(result.kind).toBe("found");
    expect(cacheCalls).not.toContain("put");
  });

  test("answers when the cache write fails", async () => {
    const { cache } = fakeCache({ put: "throw" });
    const { source } = fakeSource({ link: link(), eligible: true });
    const result = await readRouteView({ cache, source }, "tok");
    expect(result.kind).toBe("found");
  });

  test("is unavailable when the source read fails, so the redirect fails closed", async () => {
    const { cache } = fakeCache();
    const { source } = fakeSource("throw");
    expect(await readRouteView({ cache, source }, "tok")).toEqual({ kind: "unavailable" });
  });

  test("is missing for an unknown token and stores nothing", async () => {
    const { cache, calls } = fakeCache();
    const { source } = fakeSource(null);
    expect(await readRouteView({ cache, source }, "tok")).toEqual({ kind: "missing" });
    expect(calls).not.toContain("put");
  });
});
