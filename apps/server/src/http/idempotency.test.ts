import { describe, expect, test } from "bun:test";
import { ErrorEnvelopeSchema } from "@moneytrap/contracts";
import { FakeClock, FakeIdempotencyStore, FakeIdGenerator } from "@moneytrap/test-kit";
import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";
import { createApp } from "../app";
import { idempotency } from "./idempotency";

// The handler counts its calls so a test can tell a replayed response from a second execution of the effect.
function setup() {
  const store = new FakeIdempotencyStore();
  let calls = 0;
  const app = createApp({ clock: new FakeClock(), ids: new FakeIdGenerator() })
    .use(idempotency({ store, scopeOf: () => "org_1" }))
    .post("/payments", { body: t.Object({ amount: t.String() }) }, ({ body }) => ({
      call: ++calls,
      amount: body.amount,
    }))
    .post(
      "/shipments",
      () =>
        new Response(JSON.stringify({ shipped: true }), {
          status: 201,
          headers: { "content-type": "application/json", location: "/shipments/1" },
        }),
    );
  return { app, store, calls: () => calls };
}

function post(app: { handle(request: Request): Promise<Response> }, key: string | null, amount: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key !== null) headers["idempotency-key"] = key;
  return app.handle(
    new Request("http://localhost/payments", { method: "POST", headers, body: JSON.stringify({ amount }) }),
  );
}

describe("idempotency middleware", () => {
  test("same key and same body returns the stored response without running the effect again", async () => {
    const { app, calls } = setup();

    const first = await post(app, "key-1", "10.00");
    const firstBody = await first.json();
    const second = await post(app, "key-1", "10.00");

    expect(second.status).toBe(first.status);
    expect(await second.json()).toEqual(firstBody);
    expect(calls()).toBe(1);
  });

  test("same key and different body returns STATE_CONFLICT and does not run the effect", async () => {
    const { app, calls } = setup();
    await post(app, "key-1", "10.00");

    const response = await post(app, "key-1", "99.00");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(Value.Check(ErrorEnvelopeSchema, body)).toBe(true);
    expect(body.error.code).toBe("STATE_CONFLICT");
    expect(body.error.correlation_id).toBe(response.headers.get("x-request-id"));
    expect(calls()).toBe(1);
  });

  test("different keys with the same body each run the effect", async () => {
    const { app, calls } = setup();

    await post(app, "key-1", "10.00");
    await post(app, "key-2", "10.00");

    expect(calls()).toBe(2);
  });

  test("a request without an Idempotency-Key header is not recorded", async () => {
    const { app, store, calls } = setup();

    await post(app, null, "10.00");
    await post(app, null, "10.00");

    expect(calls()).toBe(2);
    expect(store.size()).toBe(0);
  });

  test("the store never sees the raw key", async () => {
    const { app, store } = setup();

    await post(app, "super-secret-key", "10.00");

    expect(JSON.stringify([...store.entries()])).not.toContain("super-secret-key");
  });

  test("a replayed response still carries its own x-request-id", async () => {
    const { app } = setup();
    await post(app, "key-1", "10.00");

    const replay = await post(app, "key-1", "10.00");

    expect(replay.headers.get("x-request-id")).toBeTruthy();
  });

  test("replay keeps the status and headers of a handler that returns its own Response", async () => {
    const { app } = setup();
    const create = () =>
      app.handle(
        new Request("http://localhost/shipments", { method: "POST", headers: { "idempotency-key": "ship-1" } }),
      );

    const first = await create();
    const replay = await create();

    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.headers.get("location")).toBe("/shipments/1");
    expect(replay.headers.get("content-type")).toBe("application/json");
    expect(await replay.json()).toEqual({ shipped: true });
  });
});
