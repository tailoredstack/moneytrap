import { describe, expect, test } from "bun:test";
import { FakeClock, FakeIdGenerator } from "@moneytrap/test-kit";
import { createApp } from "../app";

const deps = () => ({ clock: new FakeClock(), ids: new FakeIdGenerator() });
const get = (app: { handle: (r: Request) => Promise<Response> }, path: string) =>
  app.handle(new Request(`http://localhost${path}`));

describe("/healthz", () => {
  test("reports the process is alive without touching dependencies", async () => {
    const app = createApp({ ...deps(), readiness: [{ name: "db", check: () => Promise.reject(new Error("down")) }] });

    const response = await get(app, "/healthz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});

describe("/readyz", () => {
  test("is ready with no checks configured", async () => {
    const response = await get(createApp(deps()), "/readyz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: {} });
  });

  test("is ready when every dependency check passes", async () => {
    const app = createApp({
      ...deps(),
      readiness: [
        { name: "db", check: async () => {} },
        { name: "queue", check: () => {} },
      ],
    });

    const response = await get(app, "/readyz");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", checks: { db: "ok", queue: "ok" } });
  });

  test("returns 503 and names the failing check without leaking its error", async () => {
    const app = createApp({
      ...deps(),
      readiness: [
        { name: "db", check: async () => {} },
        {
          name: "queue",
          check: () => {
            throw new Error("redis://user:hunter2@cache:6379 refused");
          },
        },
      ],
    });

    const response = await get(app, "/readyz");
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ status: "unavailable", checks: { db: "ok", queue: "unavailable" } });
    expect(text).not.toContain("hunter2");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
