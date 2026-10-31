import { describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { authOptions } from "./config";
import type { AuthMailer } from "./mailer";

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
