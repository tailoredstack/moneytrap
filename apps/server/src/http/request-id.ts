import { Elysia } from "elysia";

// Every response carries x-request-id, including 404s and validation failures. onRequest runs before
// routing, so it covers those paths too; derive would miss them. The ID is generated per request and
// never read from the client, so a caller cannot choose or spoof a correlation ID.
const ids = new WeakMap<Request, string>();

export const requestId = new Elysia({ name: "request-id" }).onRequest(({ request, set }) => {
  const id = crypto.randomUUID();
  ids.set(request, id);
  set.headers["x-request-id"] = id;
});

export function requestIdOf(request: Request): string {
  return ids.get(request) ?? crypto.randomUUID();
}
