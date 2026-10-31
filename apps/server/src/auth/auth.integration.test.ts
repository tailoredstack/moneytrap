import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { migrate, migrationProvider } from "@moneytrap/adapter-postgres";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { createAuth } from "./config";
import type { AuthMailer } from "./mailer";

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides it). Skipped otherwise.
const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const VALID_PASSWORD = "correct horse battery";
const BREACHED_PASSWORD = "password1234";

describeWithDatabase("Better Auth against Postgres (TP-W2-004, TP-W2-005)", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;
  let sent: Array<{ kind: "verify" | "reset"; to: string; url: string }>;
  let originalFetch: typeof fetch;
  let auth: ReturnType<typeof createAuth>;

  beforeEach(async () => {
    schema = `auth_test_${crypto.randomUUID().replaceAll("-", "")}`;
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
        const suffix = sha1Suffix(BREACHED_PASSWORD);
        return new Response(`${suffix}:42\r\n`, { status: 200 });
      }
      return originalFetch(input);
    }) as typeof fetch;

    auth = createAuth({
      pool,
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "https://moneytrap.test",
      mailer,
    });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
  });

  const signUp = (password: string, email = "ada@example.test") =>
    auth.api.signUpEmail({ body: { email, password, name: "Ada" }, asResponse: true });

  test("TP-W2-004: a password shorter than the minimum is rejected", async () => {
    const response = await signUp("short pass1"); // 10 characters

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(sent).toEqual([]);
  });

  test("TP-W2-004: a breached password is rejected", async () => {
    const response = await signUp(BREACHED_PASSWORD);

    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("sign-up with a valid password creates an unverified user and one verification email", async () => {
    const response = await signUp(VALID_PASSWORD);

    expect(response.status).toBe(200);
    expect(sent.map((message) => message.kind)).toEqual(["verify"]);
    const { rows } = await sql<{ email: string; emailVerified: boolean }>`
      select email, "emailVerified" from "user"`.execute(db);
    expect(rows).toEqual([{ email: "ada@example.test", emailVerified: false }]);
  });

  test("TP-W2-005: no password or verification token is written to logs during sign-up", async () => {
    const logged: string[] = [];
    const methods = ["log", "info", "warn", "error", "debug"] as const;
    const originals = methods.map((method) => console[method]);
    for (const method of methods) {
      console[method] = (...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      };
    }

    try {
      await signUp(VALID_PASSWORD);
    } finally {
      methods.forEach((method, index) => {
        console[method] = originals[index] as (typeof console)[typeof method];
      });
    }

    const token = new URL(sent[0]?.url ?? "https://none.invalid").searchParams.get("token") ?? "no-token";
    for (const line of logged) {
      expect(line).not.toContain(VALID_PASSWORD);
      expect(line).not.toContain(token);
    }
  });

  test("the migration creates the Better Auth tables", async () => {
    const tables = await db.introspection.getTables();
    const names = tables.map((table) => table.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "user",
        "session",
        "account",
        "verification",
        "twoFactor",
        "organization",
        "member",
        "invitation",
        "apikey",
      ]),
    );
  });
});

function sha1Suffix(password: string): string {
  return createHash("sha1").update(password).digest("hex").slice(5).toUpperCase();
}
