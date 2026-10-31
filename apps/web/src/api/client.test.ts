import { afterEach, describe, expect, test } from "bun:test";
import { CommandResultSchema } from "@moneytrap/contracts";
import { ApiError, apiRequest } from "./client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(body: unknown, init: ResponseInit = { status: 200 }) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  globalThis.fetch = (async (url: string, requestInit?: RequestInit) => {
    calls.push({ url, init: requestInit });
    return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

const commandResult = {
  operation_id: "op_1",
  status: "accepted",
  result: {},
  correlation_id: "c_1",
  as_of: "2026-10-31T12:00:00Z",
};

describe("apiRequest", () => {
  test("returns a body that matches the contract and sends the cookie session", async () => {
    const calls = stubFetch(commandResult);
    const body = await apiRequest(CommandResultSchema, "/commands/transfer", { method: "POST", body: "{}" });
    expect(body).toEqual(commandResult);
    expect(calls[0]?.url).toBe("/api/commands/transfer");
    expect(calls[0]?.init?.credentials).toBe("include");
  });

  test("throws ApiError carrying the contract error code and correlation id", async () => {
    stubFetch({ error: { code: "FORBIDDEN", message: "not allowed", correlation_id: "c_2" } }, { status: 403 });
    const error = await apiRequest(CommandResultSchema, "/commands/transfer").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 403, code: "FORBIDDEN", correlationId: "c_2" });
  });

  test("throws a generic ApiError when a failure body is not an error envelope", async () => {
    stubFetch("<html>bad gateway</html>", { status: 502 });
    const error = await apiRequest(CommandResultSchema, "/x").catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 502, code: "INTERNAL" });
  });

  test("rejects a 200 body that does not match the contract", async () => {
    stubFetch({ nope: true });
    await expect(apiRequest(CommandResultSchema, "/x")).rejects.toThrow("did not match");
  });
});
