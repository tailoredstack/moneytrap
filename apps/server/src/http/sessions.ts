import { Elysia, t } from "elysia";
import { authenticate, NO_MEMBERSHIPS, type SessionAuth } from "./auth";
import { errorResponse } from "./error-map";
import { guard, type PrincipalResolver } from "./guards/enforce";
import { requestIdOf } from "./request-id";

// Password change policy (Blueprint §7, UC04, TP-W2-022): every other session is revoked and the caller stays
// signed in. Better Auth rotates the caller's session in the same step, so the rotated cookie is passed back.
export const PASSWORD_CHANGE_POLICY = { revokeOtherSessions: true } as const;

// What Better Auth returns for each session. The token is a bearer secret, so it is read here and never sent to a client.
type SessionRow = { id: string; token: string; createdAt: string; expiresAt: string };

// A thin wrapper over Better Auth's session API. Better Auth stores sessions and issues tokens. This file maps its
// results to our DTOs and our error envelope. Clients see session IDs only. Each route's guard comes from the table
// in guards/routes.ts; the handlers still check the session themselves, so they stay safe when mounted alone.
export function sessionRoutes(
  auth: SessionAuth,
  principal: PrincipalResolver = (headers) => authenticate(auth, headers, NO_MEMBERSHIPS),
) {
  return new Elysia({ name: "sessions" })
    .get("/api/sessions", guard("GET /api/sessions", principal), async ({ request, set }) => {
      if (!(await auth.api.getSession({ headers: request.headers }))) return failure(set, request, "UNAUTHENTICATED");
      const listed = await auth.api.listSessions({ headers: request.headers, asResponse: true });
      if (!listed.ok) return failure(set, request, codeFor(listed.status));
      const sessions = (await listed.json()) as SessionRow[];
      return {
        data: sessions.map(({ id, createdAt, expiresAt }) => ({ id, created_at: createdAt, expires_at: expiresAt })),
      };
    })
    .delete("/api/sessions/:id", guard("DELETE /api/sessions/:id", principal), async ({ params, request, set }) => {
      if (!(await auth.api.getSession({ headers: request.headers }))) return failure(set, request, "UNAUTHENTICATED");
      const listed = await auth.api.listSessions({ headers: request.headers, asResponse: true });
      if (!listed.ok) return failure(set, request, codeFor(listed.status));
      // Only the caller's own sessions are listed, so a foreign or unknown ID gets the same answer as a missing one.
      const target = ((await listed.json()) as SessionRow[]).find((session) => session.id === params.id);
      if (!target) return failure(set, request, "RESOURCE_NOT_FOUND");
      const revoked = await auth.api.revokeSession({
        body: { token: target.token },
        headers: request.headers,
        asResponse: true,
      });
      if (!revoked.ok) return failure(set, request, codeFor(revoked.status));
      set.status = 204;
      return;
    })
    .put(
      "/api/password",
      {
        body: t.Object({ currentPassword: t.String(), newPassword: t.String() }),
        ...guard("PUT /api/password", principal),
      },
      async ({ body, request, set }) => {
        if (!(await auth.api.getSession({ headers: request.headers }))) return failure(set, request, "UNAUTHENTICATED");
        const changed = await auth.api.changePassword({
          body: { currentPassword: body.currentPassword, newPassword: body.newPassword, ...PASSWORD_CHANGE_POLICY },
          headers: request.headers,
          asResponse: true,
        });
        if (!changed.ok) return failure(set, request, codeFor(changed.status));
        // The rotated session cookie has to reach the client, or the caller is signed out by their own change.
        const headers = new Headers();
        for (const cookie of changed.headers.getSetCookie()) headers.append("set-cookie", cookie);
        return new Response(null, { status: 204, headers });
      },
    );
}

// Better Auth reports failures as HTTP statuses. Map the ones these routes can meet to our §7.1 codes.
function codeFor(status: number): string {
  if (status === 400) return "VALIDATION_FAILED";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "RESOURCE_NOT_FOUND";
  if (status === 429) return "RATE_LIMITED";
  return "INTERNAL";
}

function failure(set: { status?: number | string }, request: Request, code: string) {
  const { status, body } = errorResponse(code, requestIdOf(request), "Request failed");
  set.status = status;
  return body;
}
