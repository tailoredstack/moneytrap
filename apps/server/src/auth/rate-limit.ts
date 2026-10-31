import { createHmac } from "node:crypto";
import type { RateLimitCounter } from "@moneytrap/adapter-redis";
import { APIError } from "better-auth/api";

export type { RateLimitCounter };

export type Rule = { max: number; window: number };

// Blueprint §7 policy values. Windows are in seconds, the unit Better Auth uses. Per-IP limits are enforced by
// Better Auth through the Redis counter. Per-identity limits are counted per email, whatever the IP.
// Known trade-off: anyone can lock out one email's sign-in with bad passwords, or its recovery with requests,
// from any IP. The per-identity limit is what stops password guessing across IPs, so this is accepted.
// Sign-in counts failed attempts only, so correct passwords never throttle a user. Recovery counts every
// request, because its response does not show whether the email exists and each request sends mail.
// Operators override any value with AUTH_RATE_LIMIT_* environment variables (see rateLimitPolicy).
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

export type RateLimitPolicy = {
  signIn: { perIp: Rule; perIdentity: Rule };
  recovery: { perIp: Rule; perIdentity: Rule };
};

// What the identity checks need besides the counter: the server secret for the key and the policy values.
export type RateLimitSettings = { secret: string; policy: RateLimitPolicy };

const SIGN_IN_PATH = "/sign-in/email";

// Paths that take an email in the body, mapped to the group whose per-identity rule limits each one.
const IDENTITY_GROUP: Record<string, "signIn" | "recovery"> = {
  [SIGN_IN_PATH]: "signIn",
  "/request-password-reset": "recovery",
  "/forget-password": "recovery",
};

// Per-IP rules for Better Auth, keyed by the same paths.
export function ipRateLimitRules(policy: RateLimitPolicy = AUTH_RATE_LIMIT_POLICY): Record<string, Rule> {
  return {
    [SIGN_IN_PATH]: policy.signIn.perIp,
    "/request-password-reset": policy.recovery.perIp,
    "/forget-password": policy.recovery.perIp,
  };
}

// Better Auth's custom storage contract: count one request against key and say whether it is allowed.
// A Redis outage refuses the request with a coded 503 (see reachCounter).
export function ipRateLimitStorage(counter: RateLimitCounter) {
  return {
    async consume(key: string, rule: Rule): Promise<{ allowed: boolean; retryAfter: number | null }> {
      const count = await reachCounter(() => counter.increment(`ip:${key}`, rule.window));
      if (count <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: rule.window };
    },
  };
}

// The identity key is an HMAC of the normalized email under the server secret. Redis holds no plaintext address, and
// the keys cannot be checked against a candidate list without the secret.
function identityKey(path: string, email: string, secret: string): string {
  const kind = path === SIGN_IN_PATH ? "sign-in" : "recovery";
  const identity = createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
  return `identity:${kind}:${identity}`;
}

function refused(): APIError {
  return new APIError("TOO_MANY_REQUESTS", { code: "RATE_LIMITED", message: "Too many attempts. Try again later." });
}

// A Redis outage refuses the request with a coded 503 instead of an opaque error, so limits are never skipped.
async function reachCounter<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new APIError("SERVICE_UNAVAILABLE", {
      code: "RATE_LIMIT_UNAVAILABLE",
      message: "Rate limiting is unavailable. Please try again later.",
    });
  }
}

// Runs before the request. Sign-in is refused once the email has used up its failed attempts. Recovery counts
// this request and is refused once its budget is spent. Paths without a rule, and bodies without an email, are
// left to Better Auth.
export async function refuseIfSpent(
  counter: RateLimitCounter,
  path: string,
  body: { email?: unknown },
  settings: RateLimitSettings,
) {
  const group = IDENTITY_GROUP[path];
  if (!group || typeof body.email !== "string") return;
  const rule = settings.policy[group].perIdentity;
  const key = identityKey(path, body.email, settings.secret);
  if (path === SIGN_IN_PATH) {
    if ((await reachCounter(() => counter.count(key))) >= rule.max) throw refused();
    return;
  }
  if ((await reachCounter(() => counter.increment(key, rule.window))) > rule.max) throw refused();
}

// Runs after a sign-in that failed. Successful sign-ins and refused attempts are not recorded here.
export async function recordFailedSignIn(
  counter: RateLimitCounter,
  body: { email?: unknown },
  settings: RateLimitSettings,
) {
  if (typeof body.email !== "string") return;
  const { window } = settings.policy.signIn.perIdentity;
  await reachCounter(() => counter.increment(identityKey(SIGN_IN_PATH, body.email as string, settings.secret), window));
}

// Reads AUTH_RATE_LIMIT_{SIGN_IN,RECOVERY}_{IP,IDENTITY}_{MAX,WINDOW_SECONDS}. Unset or empty takes the default above.
// Anything that is not a positive whole number is refused at startup, as STEP_UP_WINDOW_SECONDS is.
export function rateLimitPolicy(env: Record<string, string | undefined>): RateLimitPolicy {
  const group = (name: "signIn" | "recovery", scope: "perIp" | "perIdentity"): Rule => {
    const prefix = `AUTH_RATE_LIMIT_${name === "signIn" ? "SIGN_IN" : "RECOVERY"}_${scope === "perIp" ? "IP" : "IDENTITY"}`;
    const fallback = AUTH_RATE_LIMIT_POLICY[name][scope];
    return {
      max: positive(env, `${prefix}_MAX`, fallback.max),
      window: positive(env, `${prefix}_WINDOW_SECONDS`, fallback.window),
    };
  };
  return {
    signIn: { perIp: group("signIn", "perIp"), perIdentity: group("signIn", "perIdentity") },
    recovery: { perIp: group("recovery", "perIp"), perIdentity: group("recovery", "perIdentity") },
  };
}

function positive(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return value;
}
