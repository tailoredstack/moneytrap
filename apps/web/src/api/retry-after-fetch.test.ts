import { describe, expect, test } from "bun:test";
import { withRetryAfter } from "./retry-after-fetch";

function upstream(response: Response) {
  return withRetryAfter(async () => response);
}

describe("withRetryAfter", () => {
  test("a 429 carries its Retry-After seconds in the body, where the client error keeps it", async () => {
    const response = new Response(JSON.stringify({ message: "Too many requests" }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "60" },
    });
    const wrapped = await upstream(response)("/api/auth/sign-in/email");
    expect(wrapped.status).toBe(429);
    expect(await wrapped.json()).toEqual({ message: "Too many requests", retryAfter: 60 });
  });

  test("a 429 without Retry-After reports no time", async () => {
    const response = new Response("{}", { status: 429, headers: { "content-type": "application/json" } });
    expect(await (await upstream(response)("/x")).json()).toEqual({ retryAfter: null });
  });

  test("a 429 with a non-JSON body still reports its time", async () => {
    const response = new Response("Too many", { status: 429, headers: { "retry-after": "5" } });
    expect(await (await upstream(response)("/x")).json()).toEqual({ retryAfter: 5 });
  });

  test("any other status passes through untouched", async () => {
    const response = new Response("{}", { status: 200 });
    expect(await upstream(response)("/x")).toBe(response);
  });
});
