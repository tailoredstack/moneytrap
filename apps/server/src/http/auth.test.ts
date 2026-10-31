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

  test("is not shadowed by a GET catch-all registered after it, as in serve()", async () => {
    const app = new Elysia().use(authRoutes({ handler })).get("/*", () => new Response("shell", { status: 404 }));

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

// Without trusted proxies the server sets x-forwarded-for to the socket peer, or removes it when there is no peer. A
// request whose only header is x-forwarded-for must not reach Better Auth with that header intact.
describe("client IP without trusted proxies", () => {
  test("removes a client-sent x-forwarded-for when there is no socket peer, even when no other header remains", async () => {
    let seen: string | null | undefined;
    const app = new Elysia().use(
      authRoutes(
        {
          handler: async (request: Request) => {
            seen = request.headers.get("x-forwarded-for");
            return new Response("ok");
          },
        },
        { trustProxy: false },
      ),
    );

    await app.handle(
      new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST",
        headers: { "x-forwarded-for": "fake" },
      }),
    );

    expect(seen).toBeNull();
  });
});
