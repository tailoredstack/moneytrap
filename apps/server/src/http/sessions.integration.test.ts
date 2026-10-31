import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { migrate, migrationProvider } from "@moneytrap/adapter-postgres";
import { Elysia } from "elysia";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createAuth } from "../auth/config";
import type { AuthMailer } from "../auth/mailer";
import { authRoutes } from "./auth";
import { sessionRoutes } from "./sessions";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides it). Skipped otherwise.
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const EMAIL = "ada@example.test";
const OLD_PASSWORD = "correct horse battery";
const NEW_PASSWORD = "staple battery horse";
const BREACHED_PASSWORD = "password1234";

describeWithDatabase("Password change revokes other sessions (TP-W2-022)", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;
  let sent: Array<{ kind: "verify" | "reset"; to: string; url: string }>;
  let originalFetch: typeof fetch;
  let auth: ReturnType<typeof createAuth>;
  let app: TestApp;

  beforeEach(async () => {
    schema = `sessions_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db, migrationProvider);

    sent = [];
    const mailer: AuthMailer = {
      async sendVerification(to, url) {
        sent.push({ kind: "verify", to, url });
      },
      async sendPasswordReset(to, url) {
        sent.push({ kind: "reset", to, url });
      },
    };
    originalFetch = globalThis.fetch;
    // Have I Been Pwned answers the k-anonymity range query. Only the breached password's suffix is returned.
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("api.pwnedpasswords.com/range/")) {
        return new Response(`${sha1Suffix(BREACHED_PASSWORD)}:42\r\n`, { status: 200 });
      }
      return originalFetch(input);
    }) as typeof fetch;

    auth = createAuth({
      pool,
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "https://moneytrap.test",
      mailer,
      rateLimitCounter: {
        async increment() {
          return 1;
        },
        async count() {
          return 0;
        },
      },
    });
    app = new Elysia().use(authRoutes(auth)).use(sessionRoutes(auth));
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });

  // Sign up, verify the address from the emailed link, and sign in. Each call is a separate device.
  async function signedInCookie(password: string): Promise<string> {
    const response = await auth.api.signInEmail({
      body: { email: EMAIL, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    return cookieHeader(response);
  }

  async function registerAndVerify(): Promise<void> {
    await auth.api.signUpEmail({ body: { email: EMAIL, password: OLD_PASSWORD, name: "Ada" } });
    const token = new URL(sent[0]?.url ?? "https://none.invalid").searchParams.get("token") ?? "";
    await auth.api.verifyEmail({ query: { token } });
  }

  test("a password change signs out the other sessions and keeps the current one", async () => {
    await registerAndVerify();
    const current = await signedInCookie(OLD_PASSWORD);
    const other = await signedInCookie(OLD_PASSWORD);

    const change = await app.handle(
      new Request("https://moneytrap.test/api/password", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: current },
        body: JSON.stringify({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }),
      }),
    );

    expect(change.status).toBe(204);
    // The rotated cookie from the password change is what the current session uses from here on.
    const rotated = cookieHeader(change) || current;
    expect(await sessionFor(app, rotated)).not.toBeNull();
    expect(await sessionFor(app, other)).toBeNull();
  });

  test("a wrong current password changes nothing and leaves every session signed in", async () => {
    await registerAndVerify();
    const current = await signedInCookie(OLD_PASSWORD);
    const other = await signedInCookie(OLD_PASSWORD);

    const change = await app.handle(
      new Request("https://moneytrap.test/api/password", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie: current },
        body: JSON.stringify({ currentPassword: "not the password", newPassword: NEW_PASSWORD }),
      }),
    );

    expect(change.status).toBe(400);
    expect(await sessionFor(app, current)).not.toBeNull();
    expect(await sessionFor(app, other)).not.toBeNull();
  });
});

type TestApp = { handle: (request: Request) => Promise<Response> };

async function sessionFor(app: TestApp, cookie: string): Promise<unknown> {
  const response = await app.handle(
    new Request("https://moneytrap.test/api/auth/get-session", { headers: { cookie } }),
  );
  return response.json();
}

// Builds a Cookie header from every Set-Cookie on the response, so a rotated session cookie replaces the old one.
function cookieHeader(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .filter((pair) => pair?.includes("="))
    .join("; ");
}

function sha1Suffix(password: string): string {
  return createHash("sha1").update(password).digest("hex").slice(5).toUpperCase();
}
