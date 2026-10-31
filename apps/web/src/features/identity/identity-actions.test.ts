import { describe, expect, test } from "bun:test";
import {
  acceptInvitation,
  enableTwoFactor,
  type IdentityClient,
  registerAccount,
  requestPasswordReset,
  resetPassword,
  signIn,
  validateRegistration,
  verifyRecoveryCode,
  verifyTotpCode,
} from "./identity-actions";

type Call = { method: string; input: unknown };

// A fake Better Auth client. It records every call so tests can prove the screens go through the client.
function fakeClient(replies: Partial<Record<string, { data?: unknown; error?: unknown }>> = {}) {
  const calls: Call[] = [];
  const reply = (method: string) => async (input: unknown) => {
    calls.push({ method, input });
    return replies[method] ?? { data: {}, error: null };
  };
  const client = {
    signUp: { email: reply("signUp.email") },
    signIn: { email: reply("signIn.email") },
    twoFactor: {
      verifyTotp: reply("twoFactor.verifyTotp"),
      verifyBackupCode: reply("twoFactor.verifyBackupCode"),
      enable: reply("twoFactor.enable"),
    },
    requestPasswordReset: reply("requestPasswordReset"),
    resetPassword: reply("resetPassword"),
    organization: { acceptInvitation: reply("organization.acceptInvitation") },
  } as unknown as IdentityClient;
  return { client, calls };
}

describe("registration fields (SKELETONS §1.1)", () => {
  test("checks the email before anything is sent", () => {
    expect(validateRegistration({ email: "not-an-email", password: "x".repeat(12) })).toEqual({
      field: "email",
      message: "Enter a valid email.",
    });
  });

  test("checks the password length before anything is sent", () => {
    expect(validateRegistration({ email: "ana@example.com", password: "short" })).toEqual({
      field: "password",
      message: "Password must be 12 or more characters.",
    });
  });

  test("a complete, valid form passes the local check", () => {
    expect(validateRegistration({ email: "ana@example.com", password: "x".repeat(12) })).toBeNull();
  });

  test("a server rejection names the password field when it is about the password", async () => {
    const { client } = fakeClient({
      "signUp.email": { data: null, error: { status: 400, message: "Password is too weak" } },
    });
    expect(await registerAccount(client, { email: "ana@example.com", password: "x".repeat(12) })).toEqual({
      kind: "invalid",
      field: "password",
      message: "Password is too weak",
    });
  });
});

describe("registration (TP-W2-006 to TP-W2-008)", () => {
  test("calls Better Auth sign-up with the email and password and reports the generic check-your-email outcome", async () => {
    const { client, calls } = fakeClient();
    const outcome = await registerAccount(client, { email: "ana@example.com", password: "correct horse battery" });
    expect(outcome).toEqual({ kind: "sent" });
    expect(calls).toEqual([
      {
        method: "signUp.email",
        input: { email: "ana@example.com", password: "correct horse battery", name: "ana" },
      },
    ]);
  });

  test("a known address gets the same outcome as an unknown one", async () => {
    const unknown = await registerAccount(fakeClient().client, { email: "new@example.com", password: "x".repeat(12) });
    const known = await registerAccount(
      fakeClient({ "signUp.email": { data: null, error: { status: 422, code: "USER_ALREADY_EXISTS" } } }).client,
      { email: "known@example.com", password: "x".repeat(12) },
    );
    expect(known).toEqual(unknown);
  });

  test("a validation error is shown inline with the server's message", async () => {
    const { client } = fakeClient({
      "signUp.email": { data: null, error: { status: 400, message: "Password is too short" } },
    });
    expect(await registerAccount(client, { email: "ana@example.com", password: "short" })).toEqual({
      kind: "invalid",
      field: "password",
      message: "Password is too short",
    });
  });
});

describe("sign-in (TP-W2-013, TP-W2-015, TP-W2-042)", () => {
  test("a correct password with no second factor is ok", async () => {
    const { client } = fakeClient({ "signIn.email": { data: { user: {} }, error: null } });
    expect(await signIn(client, { email: "ana@example.com", password: "p" })).toEqual({ kind: "ok" });
  });

  test("a second-factor challenge is reported so the screen moves to step-up", async () => {
    const { client } = fakeClient({ "signIn.email": { data: { twoFactorRedirect: true }, error: null } });
    expect(await signIn(client, { email: "ana@example.com", password: "p" })).toEqual({ kind: "two-factor" });
  });

  test("a 429 is rate-limited with the retry time from the response", async () => {
    const { client } = fakeClient({
      "signIn.email": {
        data: null,
        error: { status: 429, retryAfter: 42 },
      },
    });
    expect(await signIn(client, { email: "ana@example.com", password: "p" })).toEqual({
      kind: "rate-limited",
      retryAfterSeconds: 42,
    });
  });

  test("a 429 without a retry time reports the limit with no time", async () => {
    const { client } = fakeClient({ "signIn.email": { data: null, error: { status: 429 } } });
    expect(await signIn(client, { email: "ana@example.com", password: "p" })).toEqual({
      kind: "rate-limited",
      retryAfterSeconds: null,
    });
  });

  test("a wrong password is a generic failure that never echoes the password", async () => {
    const { client } = fakeClient({
      "signIn.email": { data: null, error: { status: 401, message: "Invalid email or password" } },
    });
    const outcome = await signIn(client, { email: "ana@example.com", password: "hunter2-secret" });
    expect(outcome).toEqual({ kind: "failed" });
    expect(JSON.stringify(outcome)).not.toContain("hunter2-secret");
  });
});

describe("step-up codes (TP-W2-016, TP-W2-018)", () => {
  test("a valid authenticator code is ok", async () => {
    const { client, calls } = fakeClient();
    expect(await verifyTotpCode(client, "123456")).toEqual({ kind: "ok" });
    expect(calls).toEqual([{ method: "twoFactor.verifyTotp", input: { code: "123456" } }]);
  });

  test("a wrong authenticator code is invalid", async () => {
    const { client } = fakeClient({
      "twoFactor.verifyTotp": { data: null, error: { status: 400, code: "INVALID_CODE" } },
    });
    expect(await verifyTotpCode(client, "000000")).toEqual({ kind: "invalid", message: "That code is not valid." });
  });

  test("a step-up with no pending sign-in reports challenge-expired so the user signs in again (TP-W2-043)", async () => {
    const { client } = fakeClient({
      "twoFactor.verifyTotp": { data: null, error: { status: 400, code: "INVALID_TWO_FACTOR_COOKIE" } },
    });
    expect(await verifyTotpCode(client, "123456")).toEqual({ kind: "challenge-expired" });
  });

  test("a recovery code goes to the recovery endpoint", async () => {
    const { client, calls } = fakeClient();
    expect(await verifyRecoveryCode(client, "abcd-efgh")).toEqual({ kind: "ok" });
    expect(calls).toEqual([{ method: "twoFactor.verifyBackupCode", input: { code: "abcd-efgh" } }]);
  });
});

describe("recovery (TP-W2-023, TP-W2-025)", () => {
  test("a reset request gives the same outcome for known and unknown addresses", async () => {
    const known = await requestPasswordReset(fakeClient().client, "ana@example.com");
    const unknown = await requestPasswordReset(
      fakeClient({ requestPasswordReset: { data: null, error: { status: 400, code: "USER_NOT_FOUND" } } }).client,
      "nobody@example.com",
    );
    expect(known).toEqual({ kind: "sent" });
    expect(unknown).toEqual(known);
  });

  test("a reset request sends the link back to the reset screen", async () => {
    const { client, calls } = fakeClient();
    await requestPasswordReset(client, "ana@example.com");
    expect(calls).toEqual([
      { method: "requestPasswordReset", input: { email: "ana@example.com", redirectTo: "/reset-password" } },
    ]);
  });

  test("an expired or used link asks for a new one and leaves the password unchanged", async () => {
    const { client } = fakeClient({
      resetPassword: { data: null, error: { status: 400, code: "INVALID_TOKEN" } },
    });
    expect(await resetPassword(client, { token: "t", newPassword: "x".repeat(12) })).toEqual({ kind: "expired" });
  });

  test("a valid link sets the new password", async () => {
    const { client, calls } = fakeClient();
    expect(await resetPassword(client, { token: "t", newPassword: "x".repeat(12) })).toEqual({ kind: "ok" });
    expect(calls).toEqual([{ method: "resetPassword", input: { token: "t", newPassword: "x".repeat(12) } }]);
  });
});

describe("MFA setup (TP-W2-017, TP-W2-044)", () => {
  test("enabling MFA returns the key and recovery codes exactly as the server issued them", async () => {
    const { client, calls } = fakeClient({
      "twoFactor.enable": {
        data: { totpURI: "otpauth://totp/Moneytrap", backupCodes: ["aaaa-bbbb", "cccc-dddd"] },
        error: null,
      },
    });
    expect(await enableTwoFactor(client, "current-password")).toEqual({
      kind: "ok",
      totpURI: "otpauth://totp/Moneytrap",
      backupCodes: ["aaaa-bbbb", "cccc-dddd"],
    });
    expect(calls).toEqual([{ method: "twoFactor.enable", input: { password: "current-password" } }]);
  });
});

describe("invitations (TP-W2-030)", () => {
  test("accepting an invitation returns ok", async () => {
    const { client, calls } = fakeClient();
    expect(await acceptInvitation(client, "inv_1")).toEqual({ kind: "ok" });
    expect(calls).toEqual([{ method: "organization.acceptInvitation", input: { invitationId: "inv_1" } }]);
  });

  test("accepting twice reports already-member", async () => {
    const { client } = fakeClient({
      "organization.acceptInvitation": {
        data: null,
        error: { status: 400, code: "YOU_ARE_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION" },
      },
    });
    expect(await acceptInvitation(client, "inv_1")).toEqual({ kind: "already-member" });
  });

  test("accepting an expired invitation reports expired", async () => {
    const { client } = fakeClient({
      "organization.acceptInvitation": { data: null, error: { status: 400, code: "INVITATION_EXPIRED" } },
    });
    expect(await acceptInvitation(client, "inv_1")).toEqual({ kind: "expired" });
  });
});
