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
