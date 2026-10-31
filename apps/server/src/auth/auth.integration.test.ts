import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { migrate, migrationProvider } from "@moneytrap/adapter-postgres";
import type { NotificationMessage, Notifier } from "@moneytrap/app";
import { createEmailVerificationToken } from "better-auth/api";
import { Elysia } from "elysia";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import { authRoutes } from "../http/auth";
import { createAuth } from "./config";
import { type AuthMailer, notifierMailer } from "./mailer";

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

  const verifyLink = (token: string) =>
    auth.handler(new Request(`https://moneytrap.test/api/auth/verify-email?token=${encodeURIComponent(token)}`));
  const tokenFromSentEmail = () => new URL(sent[0]?.url ?? "https://none.invalid").searchParams.get("token") ?? "";

  test("TP-W2-009: a valid verification token verifies the user", async () => {
    await signUp(VALID_PASSWORD);

    const response = await verifyLink(tokenFromSentEmail());

    expect(response.status).toBe(200);
    const { rows } = await sql<{ emailVerified: boolean }>`select "emailVerified" from "user"`.execute(db);
    expect(rows).toEqual([{ emailVerified: true }]);
  });

  test("TP-W2-010: a verification token cannot be used twice", async () => {
    await signUp(VALID_PASSWORD);
    const token = tokenFromSentEmail();
    await verifyLink(token);

    const second = await verifyLink(token);

    expect(second.status).toBeGreaterThanOrEqual(400);
  });

  test("TP-W2-010: a non-canonical spelling of a token is refused and does not consume it", async () => {
    await signUp(VALID_PASSWORD);
    const token = tokenFromSentEmail();
    const [header, payload, signature] = token.split(".");

    const paddedSignature = await verifyLink(`${header}.${payload}.${signature}=`);
    const trailingSpace = await verifyLink(`${header}.${payload}.${signature} `);

    expect(paddedSignature.status).toBeGreaterThanOrEqual(400);
    expect(trailingSpace.status).toBeGreaterThanOrEqual(400);
    expect((await verifyLink(token)).status).toBe(200);
  });

  test("a verification request with an untrusted callbackURL is refused and does not consume the link", async () => {
    await signUp(VALID_PASSWORD);
    const token = tokenFromSentEmail();

    const untrusted = await auth.handler(
      new Request(
        `https://moneytrap.test/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent("https://evil.example")}`,
      ),
    );

    expect(untrusted.status).toBeGreaterThanOrEqual(400);
    expect(untrusted.headers.get("location")).toBeNull();
    const { rows } = await sql<{ emailVerified: boolean }>`select "emailVerified" from "user"`.execute(db);
    expect(rows).toEqual([{ emailVerified: false }]);
    expect((await verifyLink(token)).status).toBe(200);
  });

  test("a used claim is retained for at least as long as the token can still be valid", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());

    const { rows } = await sql<{ remainingMs: number }>`
      select (extract(epoch from ("expiresAt" - now())) * 1000)::float8 as "remainingMs"
      from "verification" where "value" = 'used'`.execute(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.remainingMs).toBeGreaterThan(60 * 60 * 1000);
  });

  test("an expired verification token is rejected and leaves the user unverified", async () => {
    await signUp(VALID_PASSWORD);
    const expired = await createEmailVerificationToken(
      "test-secret-at-least-32-characters-long",
      "ada@example.test",
      undefined,
      -60,
    );

    const response = await verifyLink(expired);

    expect(response.status).toBeGreaterThanOrEqual(400);
    const { rows } = await sql<{ emailVerified: boolean }>`select "emailVerified" from "user"`.execute(db);
    expect(rows).toEqual([{ emailVerified: false }]);
  });

  test("simultaneous requests with one valid link let exactly one succeed", async () => {
    await signUp(VALID_PASSWORD);
    const token = tokenFromSentEmail();

    const responses = await Promise.all([verifyLink(token), verifyLink(token), verifyLink(token)]);

    expect(responses.map((response) => response.status).filter((status) => status === 200)).toHaveLength(1);
  });

  test("TP-W2-007/008: a known and an unknown email get the same sign-up response", async () => {
    await signUp(VALID_PASSWORD, "ada@example.test");

    const known = await signUp(VALID_PASSWORD, "ada@example.test");
    const unknown = await signUp(VALID_PASSWORD, "grace@example.test");

    expect(known.status).toBe(unknown.status);
    const knownBody = (await known.json()) as { token: unknown; user: Record<string, unknown> };
    const unknownBody = (await unknown.json()) as { token: unknown; user: Record<string, unknown> };
    expect(knownBody.token).toBeNull();
    expect(unknownBody.token).toBeNull();
    expect(Object.keys(knownBody.user).sort()).toEqual(Object.keys(unknownBody.user).sort());
    expect(sent.filter((message) => message.to === "ada@example.test")).toHaveLength(1);
  });

  test("the verification email goes through the Notifier with a verify-email dedup key", async () => {
    const messages: NotificationMessage[] = [];
    const notifier: Notifier = {
      async send(message) {
        messages.push(message);
      },
    };
    auth = createAuth({
      pool,
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "https://moneytrap.test",
      mailer: notifierMailer(notifier),
    });

    await signUp(VALID_PASSWORD);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.to).toBe("ada@example.test");
    expect(messages[0]?.dedupKey).toMatch(/^verify-email:[0-9a-f]{64}$/);
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

  describe("password recovery (WP-2.5)", () => {
    const NEW_PASSWORD = "a different long passphrase";
    const resetSent = () => sent.filter((message) => message.kind === "reset");
    const resetTokenFromSentEmail = () => {
      const url = new URL(resetSent().at(-1)?.url ?? "https://none.invalid");
      return url.pathname.split("/").at(-1) ?? "";
    };

    // Verifies the account first, because sign-in requires a verified email.
    const verifiedUser = async () => {
      await signUp(VALID_PASSWORD);
      await verifyLink(tokenFromSentEmail());
    };
    const requestReset = (email = "ada@example.test") =>
      auth.api.requestPasswordReset({ body: { email, redirectTo: "https://moneytrap.test/reset" }, asResponse: true });
    const redeem = (token: string, newPassword = NEW_PASSWORD) =>
      auth.api.resetPassword({ body: { newPassword, token }, asResponse: true });
    const signIn = (password: string) =>
      auth.api.signInEmail({ body: { email: "ada@example.test", password }, asResponse: true });

    test("TP-W2-023: a reset request for an unknown identity has the same response as a known one", async () => {
      await verifiedUser();

      const known = await requestReset("ada@example.test");
      const unknown = await requestReset("grace@example.test");

      expect(known.status).toBe(unknown.status);
      expect(resetSent().map((message) => message.to)).toEqual(["ada@example.test"]);
    });

    test("the reset link works once and sets the new password", async () => {
      await verifiedUser();
      await requestReset();
      const token = resetTokenFromSentEmail();

      const first = await redeem(token);
      const second = await redeem(token, "yet another long passphrase");

      expect(first.status).toBe(200);
      expect(second.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(NEW_PASSWORD)).status).toBe(200);
      expect((await signIn("yet another long passphrase")).status).toBeGreaterThanOrEqual(400);
    });

    test("TP-W2-025: an expired reset link is refused and leaves the password unchanged", async () => {
      await verifiedUser();
      await requestReset();
      const token = resetTokenFromSentEmail();
      await sql`update "verification" set "expiresAt" = now() - interval '1 minute' where "identifier" = ${`reset-password:${token}`}`.execute(
        db,
      );

      const response = await redeem(token);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(VALID_PASSWORD)).status).toBe(200);
    });

    test("TP-W2-024: simultaneous redemptions of one reset link let exactly one succeed", async () => {
      await verifiedUser();
      await requestReset();
      const token = resetTokenFromSentEmail();

      const responses = await Promise.all([redeem(token), redeem(token), redeem(token)]);

      expect(responses.map((response) => response.status).filter((status) => status === 200)).toHaveLength(1);
      expect((await signIn(NEW_PASSWORD)).status).toBe(200);
    });

    test("a successful reset revokes every other session of the user", async () => {
      await verifiedUser();
      await signIn(VALID_PASSWORD);
      await signIn(VALID_PASSWORD);
      const before = await sql<{ count: string }>`select count(*)::text as count from "session"`.execute(db);
      expect(before.rows[0]?.count).toBe("2");
      await requestReset();

      await redeem(resetTokenFromSentEmail());

      const after = await sql<{ count: string }>`select count(*)::text as count from "session"`.execute(db);
      expect(after.rows[0]?.count).toBe("0");
    });

    test("TP-W2-026: a reset link stops working once the password changes by another path", async () => {
      await verifiedUser();
      const signedIn = await signIn(VALID_PASSWORD);
      const cookie = signedIn.headers.get("set-cookie") ?? "";
      await requestReset();
      const token = resetTokenFromSentEmail();

      const changed = await auth.api.changePassword({
        body: { currentPassword: VALID_PASSWORD, newPassword: NEW_PASSWORD },
        headers: new Headers({ cookie }),
        asResponse: true,
      });
      expect(changed.status).toBe(200);

      const response = await redeem(token, "yet another long passphrase");

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(NEW_PASSWORD)).status).toBe(200);
    });
  });

  test("the mounted handler answers get-session with no session through the app", async () => {
    const app = new Elysia().use(authRoutes(auth)).get("/*", () => new Response("shell", { status: 404 }));

    const response = await app.handle(new Request("https://moneytrap.test/api/auth/get-session"));

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
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
