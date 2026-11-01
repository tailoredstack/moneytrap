import type { Id, Membership, Principal } from "@moneytrap/domain";
import { Elysia } from "elysia";
import type { createAuth } from "../auth/config";
import { guard } from "./guards/enforce";

// The slice of a Better Auth instance this layer needs. Authentication (who is calling) happens in
// the Better Auth session; authorization happens in route guards, not here (AGENTS.md, moneytrap-auth).
export type AuthHandler = { handler: (request: Request) => Response | Promise<Response> };

export type SessionAuth = Pick<ReturnType<typeof createAuth>, "api">;
export type AuthSession = ReturnType<typeof createAuth>["$Infer"]["Session"];
export type AuthenticatedPrincipal = Principal & { globalRole?: AuthSession["user"]["role"] | null | undefined };

// Reads a user's memberships. The only source of roles (spec §4.1). Callers in the composition root supply it.
export type MembershipLoader = (userId: Id<"user">) => Promise<readonly Membership[]>;

// No membership reader exists yet. Until one does, every permission-guarded route sees no memberships and
// denies with RESOURCE_NOT_FOUND, so the default fails closed.
export const NO_MEMBERSHIPS: MembershipLoader = async () => [];

// Resolves the caller into a Principal from the Better Auth session. Returns null when there is no session.
// Better Auth issues the user ID and does not use our `usr_` prefix, so it is branded here rather than parsed.
export async function authenticate(
  auth: SessionAuth,
  headers: Headers,
  memberships: MembershipLoader,
): Promise<AuthenticatedPrincipal | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const userId = session.user.id as Id<"user">;
  return { userId, memberships: await memberships(userId), globalRole: session.user.role ?? null };
}

// Forwards every method under /api/auth to Better Auth. Its own routes handle sign-up, sessions,
// verification, reset, two-factor, organizations, and API keys.
//
// With no trusted proxy, the client may send any x-forwarded-for it likes. Better Auth reads that header for per-IP
// limits, so the server replaces it with the socket peer address first. A trusted proxy keeps the header it appends.
export function authRoutes(auth: AuthHandler, options: { trustProxy: boolean } = { trustProxy: true }) {
  const forward = ({ request, server }: { request: Request; server?: ServerPeer | null }) =>
    auth.handler(options.trustProxy ? request : withPeerAddress(request, server?.requestIP(request)?.address));
  // One route per method. In Elysia 2 a method-specific catch-all such as GET /* wins over an `.all` wildcard,
  // so `.all` would let the app shell swallow GET /api/auth/* requests. Each method carries its own guard entry.
  return new Elysia({ name: "auth" })
    .get("/api/auth/*", guard("GET /api/auth/*"), forward)
    .post("/api/auth/*", guard("POST /api/auth/*"), forward)
    .put("/api/auth/*", guard("PUT /api/auth/*"), forward)
    .patch("/api/auth/*", guard("PATCH /api/auth/*"), forward)
    .delete("/api/auth/*", guard("DELETE /api/auth/*"), forward)
    .options("/api/auth/*", guard("OPTIONS /api/auth/*"), forward);
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
