import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { authOptions } from "./config";
import type { AuthMailer } from "./mailer";
import { recordFailedSignIn } from "./rate-limit";

// Config assertions only. No database is opened: the pool is never connected here.
function setup() {
  const sent: Array<{ kind: "verify" | "reset"; to: string; url: string }> = [];
  const mailer: AuthMailer = {
    async sendVerification(to, url) {
      sent.push({ kind: "verify", to, url });
    },
    async sendPasswordReset(to, url) {
      sent.push({ kind: "reset", to, url });
    },
  };
  const options = authOptions({
    pool: new Pool({ connectionString: "postgres://unused.invalid/db" }),
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
  return { options, sent };
}

describe("Better Auth config (Blueprint §7)", () => {
  test("email and password requires verification, sets a 12-character minimum, and revokes sessions on reset", () => {
    const { options } = setup();

    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
    });
  });

  test("does not replace Better Auth's password hashing (no custom hashing)", () => {
    const { options } = setup();

    expect(options.emailAndPassword?.password).toBeUndefined();
  });

  test("sends verification on sign-up through the injected mailer", async () => {
    const { options, sent } = setup();

    expect(options.emailVerification?.sendOnSignUp).toBe(true);
    await options.emailVerification?.sendVerificationEmail?.(
      { user: { email: "ada@example.test" } as never, url: "https://x.test/verify?token=t", token: "t" },
      new Request("https://moneytrap.test/api/auth/sign-up/email"),
    );

    expect(sent).toEqual([{ kind: "verify", to: "ada@example.test", url: "https://x.test/verify?token=t" }]);
  });

  test("sessions are fresh only within the step-up window, so sensitive routes need recent login (TP-W2-019)", () => {
    const { options } = setup();

    expect(options.session?.freshAge).toBe(900);
  });

  test("the two-factor plugin is enabled so TOTP enrollment and backup codes are available (TP-W2-017, TP-W2-018)", () => {
    const { options } = setup();

    expect(options.plugins?.some((p) => p.id === "two-factor")).toBe(true);
  });

  test("verification links expire after one hour, set explicitly rather than left to the default", () => {
    const { options } = setup();

    expect(options.emailVerification?.expiresIn).toBe(3600);
  });

  test("sends password reset through the injected mailer", async () => {
    const { options, sent } = setup();

    await options.emailAndPassword?.sendResetPassword?.(
      { user: { email: "ada@example.test" } as never, url: "https://x.test/reset?token=r", token: "r" },
      new Request("https://moneytrap.test/api/auth/request-password-reset"),
    );

    expect(sent).toEqual([{ kind: "reset", to: "ada@example.test", url: "https://x.test/reset?token=r" }]);
  });

  test("enables the two-factor, organization, API key, and breached-password plugins", () => {
    const { options } = setup();
    const ids = (options.plugins ?? []).map((plugin) => plugin.id);

    expect(ids).toEqual(expect.arrayContaining(["two-factor", "organization", "api-key", "have-i-been-pwned"]));
  });

  test("passes the secret and base URL through unchanged", () => {
    const { options } = setup();

    expect(options.secret).toBe("test-secret-at-least-32-characters-long");
    expect(options.baseURL).toBe("https://moneytrap.test");
  });
});

describe("auth rate limits (WP-2.14)", () => {
  test("enables Better Auth limits with the per-IP rules and the shared counter", () => {
    const { options } = setup();

    expect(options.rateLimit?.enabled).toBe(true);
    expect(Object.keys(options.rateLimit?.customRules ?? {}).sort()).toEqual([
      "/forget-password",
      "/request-password-reset",
      "/sign-in/email",
    ]);
    expect(options.rateLimit?.customStorage).toBeDefined();
  });

  test("refuses a login once the email has used up its failed attempts, before the password is checked", async () => {
    const counts = new Map<string, number>();
    const counter = {
      async increment(key: string) {
        const next = (counts.get(key) ?? 0) + 1;
        counts.set(key, next);
        return next;
      },
      async count(key: string) {
        return counts.get(key) ?? 0;
      },
    };
    const options = authOptions({
      pool: new Pool({ connectionString: "postgres://unused.invalid/db" }),
      secret: "test-secret-at-least-32-characters-long",
      baseURL: "https://moneytrap.test",
      mailer: { async sendVerification() {}, async sendPasswordReset() {} },
      rateLimitCounter: counter,
    });
    const before = options.hooks?.before;
    expect(before).toBeDefined();

    const ctx = { path: "/sign-in/email", body: { email: "ada@example.test" }, query: {} };
    // A correct-password login is not recorded, so the limit does not move however often it is tried.
    for (let i = 0; i < 10; i++) await expect(before?.(ctx as never)).resolves.toBeUndefined();

    // Five recorded failures spend the budget, and the next login is refused without touching the database.
    await recordFailedSignIn(counter, ctx.body);
    await recordFailedSignIn(counter, ctx.body);
    await recordFailedSignIn(counter, ctx.body);
    await recordFailedSignIn(counter, ctx.body);
    await recordFailedSignIn(counter, ctx.body);
    await expect(before?.(ctx as never)).rejects.toMatchObject({ statusCode: 429 });
  });
});
