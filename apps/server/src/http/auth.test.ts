import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { authRoutes } from "./auth";

// The Better Auth handler is replaced with a stub here. Routing is what this test covers.
const handler = async (request: Request) => Response.json({ ok: true, path: new URL(request.url).pathname });

describe("/api/auth mount", () => {
  test("forwards every method and path under /api/auth/ to the Better Auth handler", async () => {
    const app = new Elysia().use(authRoutes({ handler }));

    const get = await app.handle(new Request("http://localhost/api/auth/get-session"));
    const post = await app.handle(new Request("http://localhost/api/auth/sign-up/email", { method: "POST" }));

    expect(await get.json()).toEqual({ ok: true, path: "/api/auth/get-session" });
    expect(await post.json()).toEqual({ ok: true, path: "/api/auth/sign-up/email" });
  });

  test("does not claim paths outside /api/auth", async () => {
    const app = new Elysia().use(authRoutes({ handler }));

    const response = await app.handle(new Request("http://localhost/api/authors"));

    expect(response.status).toBe(404);
  });
});
