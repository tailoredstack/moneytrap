import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { PASSWORD_CHANGE_POLICY, sessionRoutes } from "./sessions";

// Policy only (TP-W2-022). Better Auth is replaced with a stub that records what the wrapper asks for.
// The real revocation is covered against Postgres in sessions.integration.test.ts.
describe("password change policy (TP-W2-022)", () => {
  test("a password change revokes every other session and keeps the current one", async () => {
    const calls: Array<{ body: Record<string, unknown>; headers: Headers }> = [];
    const auth = {
      api: {
        getSession: async () => ({ session: { id: "current" }, user: { id: "user-1" } }),
        changePassword: async (input: { body: Record<string, unknown>; headers: Headers }) => {
          calls.push(input);
          return new Response(null, { status: 200 });
        },
      },
    };
    const app = new Elysia().use(sessionRoutes(auth as never));

    const response = await app.handle(
      new Request("https://moneytrap.test/api/password", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: "better-auth.session_token=abc" },
        body: JSON.stringify({ currentPassword: "old-password-here", newPassword: "new-password-here" }),
      }),
    );

    expect(response.status).toBe(204);
    expect(PASSWORD_CHANGE_POLICY).toEqual({ revokeOtherSessions: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      currentPassword: "old-password-here",
      newPassword: "new-password-here",
      revokeOtherSessions: true,
    });
  });

  test("a password change without a session is rejected before Better Auth changes anything", async () => {
    const calls: unknown[] = [];
    const auth = {
      api: {
        getSession: async () => null,
        changePassword: async (input: unknown) => {
          calls.push(input);
          return new Response(null, { status: 200 });
        },
      },
    };
    const app = new Elysia().use(sessionRoutes(auth as never));

    const response = await app.handle(
      new Request("https://moneytrap.test/api/password", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: "old-password-here", newPassword: "new-password-here" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });
});

// CT-005: another user's session and a nonexistent ID must look the same to the caller (TP-W2-033, TP-W2-034).
describe("session revoke not-found rule (CT-005)", () => {
  const auth = {
    api: {
      getSession: async () => ({ session: { id: "current" }, user: { id: "user-1" } }),
      listSessions: async () =>
        new Response(
          JSON.stringify([{ id: "own", token: "t-own", createdAt: "2026-10-01", expiresAt: "2026-11-01" }]),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      revokeSession: async () => new Response(null, { status: 200 }),
    },
  };

  const revoke = (id: string) =>
    new Elysia().use(sessionRoutes(auth as never)).handle(
      new Request(`https://moneytrap.test/api/sessions/${id}`, {
        method: "DELETE",
        headers: { cookie: "better-auth.session_token=abc" },
      }),
    );

  test("a session that belongs to another user returns the same response as a missing one", async () => {
    const foreign = await revoke("foreign-session");
    const missing = await revoke("does-not-exist");
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    // correlation_id is per request by design, so it is the only field allowed to differ.
    const withoutCorrelation = async (response: Response) => {
      const body = (await response.json()) as { error: Record<string, unknown> };
      const { correlation_id: _, ...error } = body.error;
      return { error };
    };
    const foreignBody = await withoutCorrelation(foreign);
    expect(foreignBody).toEqual(await withoutCorrelation(missing));
    expect(foreignBody).toEqual({ error: { code: "RESOURCE_NOT_FOUND", message: "Request failed" } });
  });
});
