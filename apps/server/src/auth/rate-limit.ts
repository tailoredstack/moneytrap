import type { RateLimitCounter } from "@moneytrap/adapter-redis";
import { APIError } from "better-auth/api";

export type { RateLimitCounter };

// Blueprint §7 policy values. Windows are in seconds, the unit Better Auth uses. Per-IP limits are enforced by
// Better Auth through the Redis counter. Per-identity limits are counted per email, whatever the IP.
// Known trade-off: anyone can lock out one email's sign-in with bad passwords, or its recovery with requests,
// from any IP. The per-identity limit is what stops password guessing across IPs, so this is accepted.
// Sign-in counts failed attempts only, so correct passwords never throttle a user. Recovery counts every
// request, because its response does not show whether the email exists and each request sends mail.
export const AUTH_RATE_LIMIT_POLICY = {
  signIn: {
    perIp: { max: 10, window: 600 },
    perIdentity: { max: 5, window: 900 },
  },
  recovery: {
    perIp: { max: 5, window: 3600 },
    perIdentity: { max: 3, window: 3600 },
  },
} as const;

type Rule = { max: number; window: number };

const SIGN_IN_PATH = "/sign-in/email";

// Paths that take an email in the body, mapped to the rule that limits each one per identity.
const IDENTITY_RULES: Record<string, Rule> = {
  [SIGN_IN_PATH]: AUTH_RATE_LIMIT_POLICY.signIn.perIdentity,
  "/request-password-reset": AUTH_RATE_LIMIT_POLICY.recovery.perIdentity,
  "/forget-password": AUTH_RATE_LIMIT_POLICY.recovery.perIdentity,
};

// Per-IP rules for Better Auth, keyed by the same paths.
export function ipRateLimitRules(): Record<string, Rule> {
  return {
    [SIGN_IN_PATH]: AUTH_RATE_LIMIT_POLICY.signIn.perIp,
    "/request-password-reset": AUTH_RATE_LIMIT_POLICY.recovery.perIp,
    "/forget-password": AUTH_RATE_LIMIT_POLICY.recovery.perIp,
  };
}

// Better Auth's custom storage contract: count one request against key and say whether it is allowed.
export function ipRateLimitStorage(counter: RateLimitCounter) {
  return {
    async consume(key: string, rule: Rule): Promise<{ allowed: boolean; retryAfter: number | null }> {
      if ((await counter.increment(`ip:${key}`, rule.window)) <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: rule.window };
    },
  };
}

function identityKey(path: string, email: string): string {
  const kind = path === SIGN_IN_PATH ? "sign-in" : "recovery";
  return `identity:${kind}:${email.trim().toLowerCase()}`;
}

function refused(): APIError {
  return new APIError("TOO_MANY_REQUESTS", { code: "RATE_LIMITED", message: "Too many attempts. Try again later." });
}

// Runs before the request. Sign-in is refused once the email has used up its failed attempts. Recovery counts
// this request and is refused once its budget is spent. Paths without a rule, and bodies without an email, are
// left to Better Auth.
export async function refuseIfSpent(counter: RateLimitCounter, path: string, body: { email?: unknown }) {
  const rule = IDENTITY_RULES[path];
  if (!rule || typeof body.email !== "string") return;
  const key = identityKey(path, body.email);
  if (path === SIGN_IN_PATH) {
    if ((await counter.count(key)) >= rule.max) throw refused();
    return;
  }
  if ((await counter.increment(key, rule.window)) > rule.max) throw refused();
}

// Runs after a sign-in that failed. Successful sign-ins and refused attempts are not recorded here.
export async function recordFailedSignIn(counter: RateLimitCounter, body: { email?: unknown }) {
  if (typeof body.email !== "string") return;
  await counter.increment(identityKey(SIGN_IN_PATH, body.email), AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.window);
}
