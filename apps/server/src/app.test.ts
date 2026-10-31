import { describe, expect, test } from "bun:test";
import { ErrorEnvelopeSchema } from "@moneytrap/contracts";
import { FakeClock, FakeIdGenerator } from "@moneytrap/test-kit";
import { Value } from "@sinclair/typebox/value";
import { t } from "elysia";
import { createApp } from "./app";

const deps = () => ({ clock: new FakeClock(), ids: new FakeIdGenerator(), readiness: [] });

describe("createApp", () => {
  test("returns an app that serves requests through app.handle()", async () => {
    const app = createApp(deps()).get("/probe", () => ({ ok: true }));

    const response = await app.handle(new Request("http://localhost/probe"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("every response carries an x-request-id header", async () => {
    const app = createApp(deps()).get("/probe", () => "ok");

    const hit = await app.handle(new Request("http://localhost/probe"));
    const miss = await app.handle(new Request("http://localhost/missing"));

    expect(hit.headers.get("x-request-id")).toBeTruthy();
    expect(miss.status).toBe(404);
    expect(miss.headers.get("x-request-id")).toBeTruthy();
  });

  test("each request gets its own request id", async () => {
    const app = createApp(deps()).get("/probe", () => "ok");

    const first = await app.handle(new Request("http://localhost/probe"));
    const second = await app.handle(new Request("http://localhost/probe"));

    expect(first.headers.get("x-request-id")).not.toBe(second.headers.get("x-request-id"));
  });

  test("an unexpected failure returns the INTERNAL envelope with the request id as correlation_id", async () => {
    const app = createApp(deps()).get("/boom", () => {
      throw new Error("db password is hunter2");
    });

    const response = await app.handle(new Request("http://localhost/boom"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(Value.Check(ErrorEnvelopeSchema, body)).toBe(true);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("hunter2");
    expect(body.error.correlation_id).toBe(response.headers.get("x-request-id"));
  });

  test("a body that fails validation returns VALIDATION_FAILED with the request id", async () => {
    const app = createApp(deps()).post("/items", { body: t.Object({ name: t.String() }) }, () => "ok");

    const response = await app.handle(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 42 }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.correlation_id).toBe(response.headers.get("x-request-id"));
  });
});
