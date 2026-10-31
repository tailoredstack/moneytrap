import { decideReplay, type IdempotencyStore } from "@moneytrap/app";
import { Elysia } from "elysia";
import { errorResponse } from "./error-map";
import { requestIdOf } from "./request-id";

// Mutating requests that carry an Idempotency-Key header are recorded per scope. A repeat with the same key and
// body replays the stored response; the same key with a different body is STATE_CONFLICT. Requests without the
// header pass through: which routes require a key is the route's decision. Only responses below 500 are stored,
// so a transient failure can be retried with the same key.
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HEADER = "idempotency-key";

type Pending = { scope: string; keyHash: string; requestHash: string };
const pending = new WeakMap<Request, Pending>();

export function idempotency(options: { store: IdempotencyStore; scopeOf: (request: Request) => string }) {
  const { store, scopeOf } = options;

  return new Elysia({ name: "idempotency" })
    .onRequest(async ({ request }) => {
      const key = request.headers.get(HEADER);
      if (!key || !MUTATING.has(request.method)) return;

      const scope = scopeOf(request);
      const keyHash = await sha256Hex(key);
      const requestHash = await sha256Hex(
        `${request.method} ${new URL(request.url).pathname}\n${await request.clone().text()}`,
      );
      const decision = decideReplay(await store.find(scope, keyHash), requestHash);

      if (decision.kind === "replay") {
        return new Response(decision.body, { status: decision.status, headers: decision.headers });
      }
      if (decision.kind === "conflict") {
        const { status, body } = errorResponse(
          "STATE_CONFLICT",
          requestIdOf(request),
          "Idempotency key was reused with a different request",
        );
        return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      }
      pending.set(request, { scope, keyHash, requestHash });
    })
    .mapResponse("global", async ({ request, responseValue, set }) => {
      const record = pending.get(request);
      if (!record) return;

      // A handler that returns its own Response decides the status and headers, so take them from that Response.
      const own = responseValue instanceof Response ? responseValue : null;
      const status = own ? own.status : Number(set.status ?? 200);
      if (status >= 500) return;

      const body = own
        ? await own.clone().text()
        : typeof responseValue === "string"
          ? responseValue
          : JSON.stringify(responseValue);
      const headers = own
        ? storable(own.headers)
        : { "content-type": typeof responseValue === "string" ? "text/plain;charset=utf-8" : "application/json" };
      await store.save(record.scope, record.keyHash, { requestHash: record.requestHash, status, headers, body });
    });
}

// The request ID is per request and is never replayed. Everything else the handler set is part of the response.
function storable(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers].filter(([name]) => name !== "x-request-id"));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
