import { Elysia } from "elysia";
import type { Cache, Store } from "./core";
import { resolveRedirect } from "./core";

const neutral = "<!doctype html><title>Temporarily unavailable</title><p>Temporarily unavailable</p>";

export function createApp(store: Store, cache: Cache, onClickError: (error: unknown) => void = console.error) {
  return new Elysia().get("/r/:token", async ({ params, request, set }) => {
    const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const result = await resolveRedirect(params.token, requestId, store, cache, onClickError);
    set.headers["x-request-id"] = requestId;
    set.headers["cache-control"] = "no-store";
    if (result.kind === "redirect") {
      set.status = 302;
      set.headers.location = result.destination;
      return "";
    }
    set.headers["content-type"] = "text/html; charset=utf-8";
    set.status = result.kind === "unavailable" ? 503 : 410;
    return neutral;
  });
}
