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
const CHANGED_PASSWORD = "a different long passphrase";

describeWithDatabase("Better Auth against Postgres (TP-W2-004, TP-W2-005)", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;
  let sent: Array<{ kind: "verify" | "reset" | "invite"; to: string; url: string }>;
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
      async sendInvitation(to, url) {
        sent.push({ kind: "invite", to, url });
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
      rateLimitCounter: {
        async increment() {
          return 1;
        },
        async count() {
          return 0;
        },
      },
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
      rateLimitCounter: {
        async increment() {
          return 1;
        },
        async count() {
          return 0;
        },
      },
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

      expect(known.status).toBe(200);
      expect(unknown.status).toBe(known.status);
      expect(await unknown.text()).toBe(await known.text());
      expect(resetSent().map((message) => message.to)).toEqual(["ada@example.test"]);
    });

    test("a concurrent failing attempt on the same link does not stop its sibling links from being retired", async () => {
      await verifiedUser();
      await requestReset();
      await requestReset();
      const [older = "", newer = ""] = resetSent().map(
        (message) => new URL(message.url).pathname.split("/").at(-1) ?? "",
      );

      // The short password fails validation right away; the valid one hashes and then succeeds.
      const [failed, succeeded] = await Promise.all([redeem(newer, "short"), redeem(newer, NEW_PASSWORD)]);
      const sibling = await redeem(older, "yet another long passphrase");

      expect(failed.status).toBeGreaterThanOrEqual(400);
      expect(succeeded.status).toBe(200);
      expect(sibling.status).toBeGreaterThanOrEqual(400);
    });

    test("a reset token sent in the query string also retires the other outstanding reset links", async () => {
      await verifiedUser();
      await requestReset();
      await requestReset();
      const [older = "", newer = ""] = resetSent().map(
        (message) => new URL(message.url).pathname.split("/").at(-1) ?? "",
      );

      const redeemed = await auth.api.resetPassword({
        body: { newPassword: NEW_PASSWORD },
        query: { token: newer },
        asResponse: true,
      });
      const sibling = await redeem(older, "yet another long passphrase");

      expect(redeemed.status).toBe(200);
      expect(sibling.status).toBeGreaterThanOrEqual(400);
    });

    test("redeeming one reset link retires the other outstanding reset links of the user", async () => {
      await verifiedUser();
      await requestReset();
      await requestReset();
      const [older = "", newer = ""] = resetSent().map(
        (message) => new URL(message.url).pathname.split("/").at(-1) ?? "",
      );

      const redeemed = await redeem(newer);
      const sibling = await redeem(older, "yet another long passphrase");

      expect(redeemed.status).toBe(200);
      expect(sibling.status).toBeGreaterThanOrEqual(400);
      expect((await signIn(NEW_PASSWORD)).status).toBe(200);
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

  test("SEC-W2-001: a password change with an old second factor does not let MFA be disabled", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret } = await enrollTotp(headers);
    const fresh = await confirmTotp(headers, secret);
    // The second factor was verified an hour ago, so the caller's session is past the step-up window.
    await sql`update "session" set "createdAt" = now() - interval '1 hour'`.execute(db);

    const changed = await auth.api.changePassword({
      body: { currentPassword: VALID_PASSWORD, newPassword: CHANGED_PASSWORD, revokeOtherSessions: true },
      headers: fresh,
      asResponse: true,
    });
    expect(changed.status).toBe(200);

    await expect(
      twoFactor().disableTwoFactor({ body: { password: CHANGED_PASSWORD }, headers: cookieHeaders(changed) }),
    ).rejects.toMatchObject({
      body: { code: "STEP_UP_REQUIRED" },
    });
    const still = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(still.rows).toEqual([{ twoFactorEnabled: true }]);
  });

  test("SEC-W2-001: a password change keeps a recent second factor, so MFA can still be disabled", async () => {
    await signUp(VALID_PASSWORD);
    await verifyLink(tokenFromSentEmail());
    const headers = await signedInHeaders();
    const { secret } = await enrollTotp(headers);
    const fresh = await confirmTotp(headers, secret);

    const changed = await auth.api.changePassword({
      body: { currentPassword: VALID_PASSWORD, newPassword: CHANGED_PASSWORD, revokeOtherSessions: true },
      headers: fresh,
      asResponse: true,
    });
    expect(changed.status).toBe(200);

    await twoFactor().disableTwoFactor({ body: { password: CHANGED_PASSWORD }, headers: cookieHeaders(changed) });
    const rows = await sql<{ twoFactorEnabled: boolean }>`select "twoFactorEnabled" from "user"`.execute(db);
    expect(rows.rows).toEqual([{ twoFactorEnabled: false }]);
  });

  describe("organization invitations (WP-2.10)", () => {
    const INVITEE = "grace@example.test";
    const HOUR_MS = 60 * 60 * 1000;

    const signUpAndVerify = async (email: string) => {
      await auth.api.signUpEmail({ body: { email, password: VALID_PASSWORD, name: email }, asResponse: true });
      const link = sent.filter((message) => message.kind === "verify" && message.to === email).at(-1);
      await verifyLink(new URL(link?.url ?? "https://none.invalid").searchParams.get("token") ?? "");
      return cookieHeaders(await auth.api.signInEmail({ body: { email, password: VALID_PASSWORD }, asResponse: true }));
    };

    const invitationRow = async (id: string) =>
      (
        await sql<{
          status: string;
          expiresAt: Date;
        }>`select status, "expiresAt" from invitation where id = ${id}`.execute(db)
      ).rows[0];

    const membershipCount = async (organizationId: string, email: string) =>
      (
        await sql<{ n: number }>`
          select count(*)::int as n from member m join "user" u on u.id = m."userId"
          where m."organizationId" = ${organizationId} and u.email = ${email}`.execute(db)
      ).rows[0]?.n;

    // Better Auth's organization endpoints run through auth.api at runtime; the config types keep them generic.
    const orgApi = () =>
      auth.api as unknown as {
        createOrganization(input: { body: { name: string; slug: string }; headers: Headers }): Promise<{ id: string }>;
        createInvitation(input: {
          body: { email: string; role: string; organizationId: string; resend?: boolean };
          headers: Headers;
        }): Promise<{ id: string }>;
        acceptInvitation(input: {
          body: { invitationId: string };
          headers: Headers;
          asResponse: true;
        }): Promise<Response>;
      };

    // Owner creates an org and invites the invitee. Returns the ids and the owner's headers.
    const invite = async () => {
      const ownerHeaders = await signUpAndVerify("ada@example.test");
      const org = await orgApi().createOrganization({ body: { name: "Acme", slug: "acme" }, headers: ownerHeaders });
      const invitation = await orgApi().createInvitation({
        body: { email: INVITEE, role: "member", organizationId: org.id },
        headers: ownerHeaders,
      });
      return { ownerHeaders, organizationId: org.id, invitationId: invitation.id };
    };

    test("an invitation sends one invite email to the invitee, expiring in 48 hours", async () => {
      const { invitationId } = await invite();

      const invites = sent.filter((message) => message.kind === "invite");
      expect(invites).toHaveLength(1);
      expect(invites[0]).toMatchObject({ to: INVITEE, url: `https://moneytrap.test/invitations/${invitationId}` });
      const row = await invitationRow(invitationId);
      expect(row?.status).toBe("pending");
      const remaining = row ? row.expiresAt.getTime() - Date.now() : 0;
      expect(remaining).toBeGreaterThan(47 * HOUR_MS);
      expect(remaining).toBeLessThanOrEqual(48 * HOUR_MS);
    });

    test("resending an invitation sends a second invite email through the hook", async () => {
      const { ownerHeaders, organizationId, invitationId } = await invite();

      await orgApi().createInvitation({
        body: { email: INVITEE, role: "member", organizationId, resend: true },
        headers: ownerHeaders,
      });

      const invites = sent.filter((message) => message.kind === "invite");
      expect(invites).toHaveLength(2);
      expect(invites.map((message) => message.url)).toEqual([
        `https://moneytrap.test/invitations/${invitationId}`,
        `https://moneytrap.test/invitations/${invitationId}`,
      ]);
    });

    test("TP-W2-030: accepting an invitation twice leaves one membership", async () => {
      const { organizationId, invitationId } = await invite();
      const inviteeHeaders = await signUpAndVerify(INVITEE);

      const first = await orgApi().acceptInvitation({
        body: { invitationId },
        headers: inviteeHeaders,
        asResponse: true,
      });
      const second = await orgApi().acceptInvitation({
        body: { invitationId },
        headers: inviteeHeaders,
        asResponse: true,
      });

      expect(first.status).toBe(200);
      expect(second.status).toBe(400);
      expect(await membershipCount(organizationId, INVITEE)).toBe(1);
      expect((await invitationRow(invitationId))?.status).toBe("accepted");
    });

    test("TP-W2-031: an expired invitation is rejected and creates no membership", async () => {
      const { organizationId, invitationId } = await invite();
      await sql`update invitation set "expiresAt" = ${new Date(Date.now() - 60_000)} where id = ${invitationId}`.execute(
        db,
      );
      const inviteeHeaders = await signUpAndVerify(INVITEE);

      const response = await orgApi().acceptInvitation({
        body: { invitationId },
        headers: inviteeHeaders,
        asResponse: true,
      });

      expect(response.status).toBe(400);
      expect(await membershipCount(organizationId, INVITEE)).toBe(0);
    });

    test("TP-W2-039: two concurrent accepts create exactly one membership", async () => {
      const { organizationId, invitationId } = await invite();
      const inviteeHeaders = await signUpAndVerify(INVITEE);

      const responses = await Promise.all([
        orgApi().acceptInvitation({ body: { invitationId }, headers: inviteeHeaders, asResponse: true }),
        orgApi().acceptInvitation({ body: { invitationId }, headers: inviteeHeaders, asResponse: true }),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
      expect(await membershipCount(organizationId, INVITEE)).toBe(1);
    });

    test("an invitation can be accepted only by the invited account", async () => {
      const { ownerHeaders, organizationId, invitationId } = await invite();

      const response = await orgApi().acceptInvitation({
        body: { invitationId },
        headers: ownerHeaders,
        asResponse: true,
      });

      expect(response.status).toBe(403);
      expect(await membershipCount(organizationId, INVITEE)).toBe(0);
      expect((await invitationRow(invitationId))?.status).toBe("pending");
    });
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
