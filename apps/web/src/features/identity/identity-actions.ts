// Identity calls go through the Better Auth client. Each action maps a client reply to a screen outcome, so the
// screens never read Better Auth error codes directly and never learn more than the visible outcome shows.

// `retryAfter` is the rate-limit wait in seconds. The fetch wrapper in api/retry-after-fetch.ts puts it in the body.
export type AuthError = {
  status: number;
  code?: string | undefined;
  message?: string | undefined;
  retryAfter?: number | null | undefined;
};
type Reply<T = unknown> = { data?: T | null | undefined; error?: AuthError | null | undefined };

// The slice of the Better Auth client these screens use. The real client satisfies it; tests pass a fake.
export type IdentityClient = {
  signUp: { email(input: { email: string; password: string; name: string }): Promise<Reply> };
  signIn: { email(input: { email: string; password: string }): Promise<Reply> };
  twoFactor: {
    verifyTotp(input: { code: string }): Promise<Reply>;
    verifyBackupCode(input: { code: string }): Promise<Reply>;
    enable(input: { password: string }): Promise<Reply>;
  };
  requestPasswordReset(input: { email: string; redirectTo: string }): Promise<Reply>;
  resetPassword(input: { token: string; newPassword: string }): Promise<Reply>;
  organization: { acceptInvitation(input: { invitationId: string }): Promise<Reply> };
};

// Better Auth reports these when an address is already registered. Showing them as an error would reveal the account.
const ALREADY_REGISTERED = new Set(["USER_ALREADY_EXISTS", "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"]);
const ALREADY_MEMBER = "YOU_ARE_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION";
const WRONG_CODE_MESSAGE = "That code is not valid.";

export function retryAfterSeconds(error: AuthError): number | null {
  return typeof error.retryAfter === "number" && error.retryAfter >= 0 ? error.retryAfter : null;
}

export type RegistrationField = "email" | "password";
export type RegistrationProblem = { field: RegistrationField; message: string };

// Checked on the client before anything is sent, so the first bad field is known without a server round trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

export function validateRegistration(input: { email: string; password: string }): RegistrationProblem | null {
  if (!EMAIL_SHAPE.test(input.email)) return { field: "email", message: "Enter a valid email." };
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { field: "password", message: `Password must be ${MIN_PASSWORD_LENGTH} or more characters.` };
  }
  return null;
}

// A server rejection names the field it is about when its message says so. Otherwise it is treated as the email.
function fieldOf(message: string): RegistrationField {
  return /password/i.test(message) ? "password" : "email";
}

export type RegisterOutcome =
  | { kind: "sent" }
  | { kind: "invalid"; field: RegistrationField; message: string }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "failed" };

// The name is the part of the address before the @. The sign-up screen asks for no name, and Better Auth requires one.
export async function registerAccount(
  client: IdentityClient,
  input: { email: string; password: string },
): Promise<RegisterOutcome> {
  const name = input.email.split("@")[0] ?? input.email;
  const { error } = await client.signUp.email({ email: input.email, password: input.password, name });
  if (!error) return { kind: "sent" };
  if (error.status === 429) return { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds(error) };
  if (error.code && ALREADY_REGISTERED.has(error.code)) return { kind: "sent" };
  if (error.status === 400 || error.status === 422) {
    const message = error.message ?? "Check the email and password.";
    return { kind: "invalid", field: fieldOf(message), message };
  }
  return { kind: "failed" };
}

export type SignInOutcome =
  | { kind: "ok" }
  | { kind: "two-factor" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "failed" };

export async function signIn(
  client: IdentityClient,
  input: { email: string; password: string },
): Promise<SignInOutcome> {
  const { data, error } = await client.signIn.email(input);
  if (error) {
    if (error.status === 429) return { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds(error) };
    return { kind: "failed" };
  }
  // The second-factor challenge arrives as a flag on an otherwise successful reply.
  const challenged =
    typeof data === "object" && data !== null && "twoFactorRedirect" in data && data.twoFactorRedirect === true;
  return challenged ? { kind: "two-factor" } : { kind: "ok" };
}

export type CodeOutcome =
  | { kind: "ok" }
  | { kind: "invalid"; message: string }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "challenge-expired" }
  | { kind: "failed" };

// Authenticator and recovery codes share one shape: a wrong code is `invalid`, and the code itself is never echoed.
async function checkCode(reply: Promise<Reply>): Promise<CodeOutcome> {
  const { error } = await reply;
  if (!error) return { kind: "ok" };
  if (error.status === 429) return { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds(error) };
  // Without a pending sign-in, Better Auth cannot match the code to a challenge. The user has to sign in again.
  if (error.code === "INVALID_TWO_FACTOR_COOKIE") return { kind: "challenge-expired" };
  if (error.status === 400 || error.status === 401) return { kind: "invalid", message: WRONG_CODE_MESSAGE };
  return { kind: "failed" };
}

export function verifyTotpCode(client: IdentityClient, code: string): Promise<CodeOutcome> {
  return checkCode(client.twoFactor.verifyTotp({ code }));
}

export function verifyRecoveryCode(client: IdentityClient, code: string): Promise<CodeOutcome> {
  return checkCode(client.twoFactor.verifyBackupCode({ code }));
}

export type ResetRequestOutcome = { kind: "sent" } | { kind: "rate-limited"; retryAfterSeconds: number | null };

// Every answer except a rate limit or a server fault reads "sent", so an unknown address looks the same as a known one.
export async function requestPasswordReset(client: IdentityClient, email: string): Promise<ResetRequestOutcome> {
  const { error } = await client.requestPasswordReset({ email, redirectTo: "/reset-password" });
  if (error?.status === 429) return { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds(error) };
  return { kind: "sent" };
}

export type ResetOutcome =
  | { kind: "ok" }
  | { kind: "expired" }
  | { kind: "rate-limited"; retryAfterSeconds: number | null }
  | { kind: "failed" };

export async function resetPassword(
  client: IdentityClient,
  input: { token: string; newPassword: string },
): Promise<ResetOutcome> {
  const { error } = await client.resetPassword(input);
  if (!error) return { kind: "ok" };
  if (error.status === 429) return { kind: "rate-limited", retryAfterSeconds: retryAfterSeconds(error) };
  if (error.code === "INVALID_TOKEN") return { kind: "expired" };
  return { kind: "failed" };
}

export type EnableTwoFactorOutcome = { kind: "ok"; totpURI: string; backupCodes: string[] } | { kind: "failed" };

// The key and recovery codes come back from the server once. The screen shows them on this screen only.
export async function enableTwoFactor(client: IdentityClient, password: string): Promise<EnableTwoFactorOutcome> {
  const { data, error } = await client.twoFactor.enable({ password });
  if (error || !isTotpSetup(data)) return { kind: "failed" };
  return { kind: "ok", totpURI: data.totpURI, backupCodes: data.backupCodes };
}

// The server answers with an OTP method or a TOTP setup. Only the TOTP setup carries a key and recovery codes.
function isTotpSetup(value: unknown): value is { totpURI: string; backupCodes: string[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    "totpURI" in value &&
    typeof value.totpURI === "string" &&
    "backupCodes" in value &&
    Array.isArray(value.backupCodes) &&
    value.backupCodes.every((code) => typeof code === "string")
  );
}

export type InvitationOutcome = { kind: "ok" } | { kind: "already-member" } | { kind: "expired" } | { kind: "failed" };

export async function acceptInvitation(client: IdentityClient, invitationId: string): Promise<InvitationOutcome> {
  const { error } = await client.organization.acceptInvitation({ invitationId });
  if (!error) return { kind: "ok" };
  if (error.code === ALREADY_MEMBER) return { kind: "already-member" };
  if (error.code === "INVITATION_EXPIRED") return { kind: "expired" };
  return { kind: "failed" };
}
