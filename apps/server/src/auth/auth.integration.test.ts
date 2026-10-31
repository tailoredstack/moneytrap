import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
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

  test("the mounted handler answers get-session with no session through the app", async () => {
    const app = new Elysia().use(authRoutes(auth)).get("/*", () => new Response("shell", { status: 404 }));

    const response = await app.handle(new Request("https://moneytrap.test/api/auth/get-session"));

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  // Turns a response's Set-Cookie headers into a request Cookie header, so later calls run with that session.
  const cookieHeaders = (response: Response) =>
    new Headers({
      cookie: response.headers
        .getSetCookie()
        .map((entry) => entry.split(";")[0]?.trim() ?? "")
        .filter(Boolean)
        .join("; "),
    });

  // The two-factor methods come from the plugin at runtime; the config types stay generic, so name them here.
  const twoFactor = () =>
    auth.api as unknown as {
      enableTwoFactor(input: {
        body: { password: string };
        headers: Headers;
      }): Promise<{ totpURI: string; backupCodes: string[] }>;
      verifyTOTP(input: { body: { code: string }; headers: Headers; asResponse: true }): Promise<Response>;
      verifyBackupCode(input: { body: { code: string }; headers: Headers; asResponse: true }): Promise<Response>;
      disableTwoFactor(input: { body: { password: string }; headers: Headers }): Promise<unknown>;
    };

  const apiKeyApi = () =>
    auth.api as unknown as {
      createApiKey(input: { body: { name: string }; headers: Headers }): Promise<{ key: string }>;
    };

  const signedInHeaders = async () =>
    cookieHeaders(
      await auth.api.signInEmail({ body: { email: "ada@example.test", password: VALID_PASSWORD }, asResponse: true }),
    );

  const enrollTotp = async (headers: Headers) => {
    const result = await twoFactor().enableTwoFactor({ body: { password: VALID_PASSWORD }, headers });
    const secret = new URL(result.totpURI).searchParams.get("secret") ?? "";
    return { secret, backupCodes: result.backupCodes };
  };

  // Confirming enrollment rotates the session, so the caller must use the returned headers from here on.
  const confirmTotp = async (headers: Headers, secret: string) =>
    cookieHeaders(await twoFactor().verifyTOTP({ body: { code: totpCode(secret) }, headers, asResponse: true }));

  test("TP-W2-017: MFA is not active until a TOTP code confirms enrollment", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();

    const { secret } = await enrollTotp(headers);
    const beforeConfirm = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(beforeConfirm.rows).toEqual([{ twoFactorEnabled: false }]);

    await confirmTotp(headers, secret);
    const afterConfirm = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(afterConfirm.rows).toEqual([{ twoFactorEnabled: true }]);
  });

  test("TP-W2-017: a wrong TOTP code does not activate MFA", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret } = await enrollTotp(headers);
    // A code that differs from the current valid one, so the control cannot pass by coincidence.
    const wrongCode = String((Number(totpCode(secret)) + 1) % 1_000_000).padStart(6, "0");

    const wrong = await twoFactor().verifyTOTP({
      body: { code: wrongCode },
      headers,
      asResponse: true,
    });
    expect(wrong.status).not.toBe(200);
    const rows = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(rows.rows).toEqual([{ twoFactorEnabled: false }]);
  });

  test("TP-W2-018: a recovery code signs in once and is rejected the second time", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret, backupCodes } = await enrollTotp(headers);
    await confirmTotp(headers, secret);
    expect(backupCodes.length).toBeGreaterThan(0);
    const code = backupCodes[0] ?? "";

    // A password sign-in for an MFA user stops at the second-factor challenge, which holds the backup code path.
    const challenge = () =>
      auth.api.signInEmail({ body: { email: "ada@example.test", password: VALID_PASSWORD }, asResponse: true });
    const challengeHeaders = cookieHeaders(await challenge());
    const first = await twoFactor().verifyBackupCode({ body: { code }, headers: challengeHeaders, asResponse: true });
    const second = await twoFactor().verifyBackupCode({
      body: { code },
      headers: cookieHeaders(await challenge()),
      asResponse: true,
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(401);
    expect(await second.json()).toMatchObject({ code: "INVALID_BACKUP_CODE" });
  });

  test("TP-W2-019: disabling MFA with a fresh session succeeds and turns MFA off", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret } = await enrollTotp(headers);
    const fresh = await confirmTotp(headers, secret);

    await twoFactor().disableTwoFactor({ body: { password: VALID_PASSWORD }, headers: fresh });

    const rows = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(rows.rows).toEqual([{ twoFactorEnabled: false }]);
  });

  test("TP-W2-019: an API-key request cannot disable MFA, even with a fresh session", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret } = await enrollTotp(headers);
    const fresh = await confirmTotp(headers, secret);
    const { key } = await apiKeyApi().createApiKey({ body: { name: "ci" }, headers: fresh });
    const viaKey = new Headers({ "x-api-key": key });

    await expect(
      twoFactor().disableTwoFactor({ body: { password: VALID_PASSWORD }, headers: viaKey }),
    ).rejects.toMatchObject({
      body: { code: "STEP_UP_REQUIRED" },
    });
    const rows = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(rows.rows).toEqual([{ twoFactorEnabled: true }]);
  });

  test("TP-W2-019: disabling MFA with a session older than the step-up window is refused", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret } = await enrollTotp(headers);
    const fresh = await confirmTotp(headers, secret);
    // Move the session's creation time past the step-up window without waiting in the test.
    await sql`update "session" set "createdAt" = now() - interval '1 hour'`.execute(db);

    await expect(
      twoFactor().disableTwoFactor({ body: { password: VALID_PASSWORD }, headers: fresh }),
    ).rejects.toMatchObject({
      body: { code: "STEP_UP_REQUIRED" },
    });
    const still = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(still.rows).toEqual([{ twoFactorEnabled: true }]);
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

// RFC 6238 TOTP (SHA-1, 6 digits, 30-second step) for a base32 secret from the enrollment URI.
function totpCode(base32Secret: string, at = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.toUpperCase().replace(/=+$/, ""))
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)?.map((byte) => Number.parseInt(byte, 2)) ?? []);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac.readUInt8(hmac.length - 1) & 0x0f;
  return String(hmac.readUInt32BE(offset) & 0x7fffffff)
    .slice(-6)
    .padStart(6, "0");
}
