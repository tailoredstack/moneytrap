import { expect, test } from "bun:test";
import { createApp } from "./app";
import { type Cache, type RouteView, resolveRedirect, type Store } from "./core";

const active: RouteView = {
  id: "route-1",
  token: "token-1",
  destination: "https://example.com/offer",
  state: "active",
  eligible: true,
  version: 1,
};

function fixture() {
  let source: RouteView = { ...active };
  let cached: RouteView | null = { ...active };
  let version: number | null = 1;
  let redisDown = false;
  let pgDown = false;
  let reads = 0;
  let clicks = 0;
  let releaseClick = () => {};
  const delayedClick = new Promise<void>((resolve) => {
    releaseClick = resolve;
  });
  const store: Store = {
    async byToken() {
      reads++;
      if (pgDown) throw Error("postgres down");
      return source;
    },
    async writeClick() {
      clicks++;
      await delayedClick;
    },
  };
  const cache: Cache = {
    async view() {
      if (redisDown) throw Error("redis down");
      return cached;
    },
    async version() {
      if (redisDown) throw Error("redis down");
      return version;
    },
    async put(view) {
      if (redisDown) throw Error("redis down");
      cached = view;
      version = view.version;
    },
  };
  return {
    store,
    cache,
    setSource(value: RouteView) {
      source = value;
    },
    setCached(value: RouteView | null, valueVersion: number | null) {
      cached = value;
      version = valueVersion;
    },
    setRedisDown(value: boolean) {
      redisDown = value;
    },
    setPgDown(value: boolean) {
      pgDown = value;
    },
    reads() {
      return reads;
    },
    clicks() {
      return clicks;
    },
    releaseClick,
  };
}

test("cache hit redirects without a Postgres read or waiting for delayed click write", async () => {
  const f = fixture();
  const result = await resolveRedirect(active.token, "request-1", f.store, f.cache, () => {});
  expect(result.kind).toBe("redirect");
  expect(f.reads()).toBe(0);
  await Promise.resolve();
  expect(f.clicks()).toBe(1);
  f.releaseClick();
});

test("version mismatch forces source read so revoked route denies", async () => {
  const f = fixture();
  f.setSource({ ...active, state: "revoked", version: 2 });
  f.setCached(active, 2);
  const result = await resolveRedirect(active.token, "request-2", f.store, f.cache, () => {});
  expect(result.kind).toBe("denied");
  expect(f.reads()).toBe(1);
});

test("expired version key forces source read", async () => {
  const f = fixture();
  f.setCached(active, null);
  await resolveRedirect(active.token, "request-3", f.store, f.cache, () => {});
  expect(f.reads()).toBe(1);
  f.releaseClick();
});

test("Redis outage falls back to Postgres", async () => {
  const f = fixture();
  f.setRedisDown(true);
  const result = await resolveRedirect(active.token, "request-4", f.store, f.cache, () => {});
  expect(result.kind).toBe("redirect");
  expect(f.reads()).toBe(1);
  f.releaseClick();
});

test("both stores down yields neutral 503 without Location", async () => {
  const f = fixture();
  f.setRedisDown(true);
  f.setPgDown(true);
  const response = await createApp(f.store, f.cache).handle(new Request(`http://localhost/r/${active.token}`));
  expect(response.status).toBe(503);
  expect(response.headers.has("location")).toBe(false);
  expect(await response.text()).not.toContain(active.destination);
});

test("unknown token gives a neutral 410", async () => {
  const f = fixture();
  f.setCached(null, null);
  const store: Store = {
    ...f.store,
    async byToken() {
      return null;
    },
  };
  const response = await createApp(store, f.cache).handle(new Request("http://localhost/r/unknown"));
  expect(response.status).toBe(410);
  expect(response.headers.has("location")).toBe(false);
});
