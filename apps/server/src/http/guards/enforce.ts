import type { Principal } from "@moneytrap/domain";
import { errorResponse } from "../error-map";
import { requestIdOf } from "../request-id";
import { decide, type Guard } from "./policy";
import { ROUTE_GUARDS } from "./routes";

// Resolves the caller from the request headers. Returns null for an anonymous caller.
export type PrincipalResolver = (headers: Headers) => Promise<Principal | null>;

export const anonymous: PrincipalResolver = async () => null;

// The route option that runs a route's guard before its handler. Spread it into the route options:
//   .get("/api/sessions", handler, guard("GET /api/sessions", principal))
// It reads the table entry for `key` and throws when there is none, so an undeclared route stops the server from
// starting. Elysia's route context does not name the matched pattern on every route, so the key is passed in.
export function guard(key: string, principal: PrincipalResolver = anonymous) {
  const declared: Guard | undefined = ROUTE_GUARDS[key];
  if (!declared) throw new Error(`route ${key} has no guard declaration`);
  return {
    beforeHandle: async ({
      request,
      params,
      set,
    }: {
      request: Request;
      params: Record<string, string>;
      set: { status?: number | string };
    }) => {
      const needsCaller = declared.access === "session" || declared.access === "permission";
      const decision = await decide(declared, needsCaller ? await principal(request.headers) : null, params);
      if (!decision.ok) return failure(set, request, decision.code);
    },
  };
}

function failure(set: { status?: number | string }, request: Request, code: string) {
  const { status, body } = errorResponse(code, requestIdOf(request), "Request failed");
  set.status = status;
  return body;
}
