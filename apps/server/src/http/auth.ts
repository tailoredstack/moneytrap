import { Elysia } from "elysia";

// The slice of a Better Auth instance this layer needs. Authentication (who is calling) happens in
// the Better Auth session; authorization happens in route guards, not here (AGENTS.md, moneytrap-auth).
export type AuthHandler = { handler: (request: Request) => Response | Promise<Response> };

// Forwards every method under /api/auth to Better Auth. Its own routes handle sign-up, sessions,
// verification, reset, two-factor, organizations, and API keys.
//
// With no trusted proxy, the client may send any x-forwarded-for it likes. Better Auth reads that header for per-IP
// limits, so the server replaces it with the socket peer address first. A trusted proxy keeps the header it appends.
export function authRoutes(auth: AuthHandler, options: { trustProxy: boolean } = { trustProxy: true }) {
  const forward = ({ request, server }: { request: Request; server?: ServerPeer | null }) =>
    auth.handler(options.trustProxy ? request : withPeerAddress(request, server?.requestIP(request)?.address));
  // One route per method. In Elysia 2 a method-specific catch-all such as GET /* wins over an `.all` wildcard,
  // so `.all` would let the app shell swallow GET /api/auth/* requests.
  return new Elysia({ name: "auth" })
    .get("/api/auth/*", forward)
    .post("/api/auth/*", forward)
    .put("/api/auth/*", forward)
    .patch("/api/auth/*", forward)
    .delete("/api/auth/*", forward)
    .options("/api/auth/*", forward);
}

// Bun's server reports the socket peer. Only the peer goes into x-forwarded-for, so a client cannot choose its bucket.
type ServerPeer = { requestIP(request: Request): { address: string } | null };

// A new Request is built from its parts. Cloning with an empty header set keeps the original headers on Bun, so a
// request whose only header was x-forwarded-for would keep it.
function withPeerAddress(request: Request, peer: string | undefined): Request {
  const headers = new Headers(request.headers);
  if (peer) headers.set("x-forwarded-for", peer);
  else headers.delete("x-forwarded-for");
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  return new Request(request.url, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    duplex: "half",
  } as RequestInit);
}
