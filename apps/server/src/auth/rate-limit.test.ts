import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import {
  AUTH_RATE_LIMIT_POLICY,
  ipRateLimitRules,
  ipRateLimitStorage,
  type RateLimitCounter,
  type RateLimitSettings,
  rateLimitPolicy,
  recordFailedSignIn,
  refuseIfSpent,
} from "./rate-limit";

// An in-memory counter with the same contract as the Redis one: increment returns the count in the window and
// count reads it without changing it.
function memoryCounter() {
  const counts = new Map<string, number>();
  const counter: RateLimitCounter & { counts: Map<string, number> } = {
    counts,
    async increment(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async count(key) {
      return counts.get(key) ?? 0;
    },
  };
  return counter;
}

const SETTINGS: RateLimitSettings = {
  secret: "test-secret-at-least-32-characters-long",
  policy: AUTH_RATE_LIMIT_POLICY,
};
const SIGN_IN = "/sign-in/email";
const RECOVERY = "/request-password-reset";
const EMAIL = "ada@example.test";

async function refuses(promise: Promise<unknown>) {
  return promise.then(
    () => false,
    (error: unknown) => {
      expect(error).toMatchObject({ statusCode: 429, body: { code: "RATE_LIMITED" } });
      return true;
    },
  );
}

describe("auth rate-limit policy (Blueprint §7, WP-2.14)", () => {
  test("login and recovery each have a per-IP and a per-identity limit, all as policy values", () => {
    expect(AUTH_RATE_LIMIT_POLICY).toEqual({
      signIn: { perIp: { max: 10, window: 600 }, perIdentity: { max: 5, window: 900 } },
      recovery: { perIp: { max: 5, window: 3600 }, perIdentity: { max: 3, window: 3600 } },
    });
  });

  test("per-IP rules cover sign-in and both recovery paths", () => {
    expect(Object.keys(ipRateLimitRules()).sort()).toEqual([
      "/forget-password",
      "/request-password-reset",
      "/sign-in/email",
    ]);
    expect(ipRateLimitRules()[SIGN_IN]).toEqual(AUTH_RATE_LIMIT_POLICY.signIn.perIp);
    expect(ipRateLimitRules()[RECOVERY]).toEqual(AUTH_RATE_LIMIT_POLICY.recovery.perIp);
  });
});

describe("sign-in per-identity limit counts failures only", () => {
  test("a correct password is never refused, however often the email signs in", async () => {
    const counter = memoryCounter();
    // Successful sign-ins never reach recordFailedSignIn, so the count stays at zero.
    for (let i = 0; i < 20; i++) {
      await refuseIfSpent(counter, SIGN_IN, { email: EMAIL }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: EMAIL }, SETTINGS))).toBe(false);
  });

  test("refuses once the email has used up its failed attempts", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: EMAIL }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: EMAIL }, SETTINGS))).toBe(true);
  });

  test("allows the failures up to the limit, then refuses the next attempt", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max - 1; i++) {
      await recordFailedSignIn(counter, { email: EMAIL }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: EMAIL }, SETTINGS))).toBe(false);
  });

  test("treats the same email in another case or with spaces as one identity", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: "Ada@Example.test" }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: " ada@example.TEST " }, SETTINGS))).toBe(true);
  });

  test("one identity being limited does not limit another", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: EMAIL }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: "grace@example.test" }, SETTINGS))).toBe(false);
  });

  test("ignores a failed sign-in with no email", async () => {
    const counter = memoryCounter();

    await recordFailedSignIn(counter, {}, SETTINGS);

    expect(counter.counts.size).toBe(0);
  });
});

describe("recovery per-identity limit counts every request", () => {
  test("refuses the request after the recovery budget is spent", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.recovery.perIdentity.max; i++) {
      await refuseIfSpent(counter, RECOVERY, { email: EMAIL }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, RECOVERY, { email: EMAIL }, SETTINGS))).toBe(true);
  });

  test("sign-in failures and recovery requests count separately for the same email", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: EMAIL }, SETTINGS);
    }

    expect(await refuses(refuseIfSpent(counter, RECOVERY, { email: EMAIL }, SETTINGS))).toBe(false);
  });
});

describe("paths and bodies outside the rules", () => {
  test("ignores paths that are not login or recovery", async () => {
    const counter = memoryCounter();

    await refuseIfSpent(counter, "/sign-up/email", { email: EMAIL }, SETTINGS);

    expect(counter.counts.size).toBe(0);
  });

  test("skips a request without an email so Better Auth's own validation answers it", async () => {
    const counter = memoryCounter();

    await refuseIfSpent(counter, RECOVERY, {}, SETTINGS);

    expect(counter.counts.size).toBe(0);
  });
});

describe("per-IP storage for Better Auth", () => {
  test("allows requests up to the rule's max, then denies with the window as retry-after", async () => {
    const storage = ipRateLimitStorage(memoryCounter());
    const rule = { window: 600, max: 2 };

    expect(await storage.consume("1.2.3.4|/sign-in/email", rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume("1.2.3.4|/sign-in/email", rule)).toEqual({ allowed: true, retryAfter: null });
    expect(await storage.consume("1.2.3.4|/sign-in/email", rule)).toEqual({ allowed: false, retryAfter: 600 });
  });
});

describe("identity keys are an HMAC under the server secret", () => {
  test("the key is exactly HMAC-SHA256 of the normalized email under the secret, not a plain hash", async () => {
    const counter = memoryCounter();

    await recordFailedSignIn(counter, { email: "  Ada@Example.test " }, SETTINGS);

    const expected = createHmac("sha256", SETTINGS.secret).update("ada@example.test").digest("hex");
    expect([...counter.counts.keys()]).toEqual([`identity:sign-in:${expected}`]);
    // A plain SHA-256 over secret and email would produce a different digest, so this assertion distinguishes them.
    const plain = createHash("sha256").update(`${SETTINGS.secret}ada@example.test`).digest("hex");
    expect(expected).not.toBe(plain);
  });

  test("the stored key contains no plaintext email", async () => {
    const counter = memoryCounter();

    await recordFailedSignIn(counter, { email: EMAIL }, SETTINGS);

    const [key] = [...counter.counts.keys()];
    expect(key).toMatch(/^identity:sign-in:[0-9a-f]{64}$/);
    expect(key).not.toContain("ada");
  });

  test("a different server secret produces a different key for the same email", async () => {
    const first = memoryCounter();
    const second = memoryCounter();

    await recordFailedSignIn(first, { email: EMAIL }, SETTINGS);
    await recordFailedSignIn(
      second,
      { email: EMAIL },
      { ...SETTINGS, secret: "another-secret-at-least-32-characters" },
    );

    expect([...first.counts.keys()][0]).not.toBe([...second.counts.keys()][0]);
  });
});

describe("a counter outage fails closed with a coded 503", () => {
  const down: RateLimitCounter = {
    increment: async () => {
      throw new Error("connect ECONNREFUSED");
    },
    count: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  };

  test("sign-in is refused with RATE_LIMIT_UNAVAILABLE", async () => {
    const error = await refuseIfSpent(down, SIGN_IN, { email: EMAIL }, SETTINGS).catch((caught) => caught);

    expect(error.statusCode).toBe(503);
    expect(error.body?.code).toBe("RATE_LIMIT_UNAVAILABLE");
  });

  test("recovery is refused with RATE_LIMIT_UNAVAILABLE", async () => {
    const error = await refuseIfSpent(down, RECOVERY, { email: EMAIL }, SETTINGS).catch((caught) => caught);

    expect(error.body?.code).toBe("RATE_LIMIT_UNAVAILABLE");
  });

  test("the per-IP storage refuses with RATE_LIMIT_UNAVAILABLE, not a silent allow", async () => {
    const storage = ipRateLimitStorage(down);

    const error = await storage.consume("1.2.3.4|/sign-in/email", { window: 600, max: 10 }).catch((caught) => caught);

    expect(error.body?.code).toBe("RATE_LIMIT_UNAVAILABLE");
  });
});

describe("policy values come from AUTH_RATE_LIMIT_* environment variables", () => {
  test("no variables gives the documented defaults", () => {
    expect(rateLimitPolicy({})).toEqual(AUTH_RATE_LIMIT_POLICY);
  });

  test("each value can be overridden on its own", () => {
    const policy = rateLimitPolicy({
      AUTH_RATE_LIMIT_SIGN_IN_IDENTITY_MAX: "7",
      AUTH_RATE_LIMIT_SIGN_IN_IDENTITY_WINDOW_SECONDS: "120",
      AUTH_RATE_LIMIT_RECOVERY_IP_MAX: "20",
    });

    expect(policy.signIn.perIdentity).toEqual({ max: 7, window: 120 });
    expect(policy.signIn.perIp).toEqual(AUTH_RATE_LIMIT_POLICY.signIn.perIp);
    expect(policy.recovery.perIp).toEqual({ max: 20, window: AUTH_RATE_LIMIT_POLICY.recovery.perIp.window });
  });

  test.each(["0", "-3", "1.5", "abc", "1e3"])("refuses %p, which is not a positive whole number", (raw) => {
    expect(() => rateLimitPolicy({ AUTH_RATE_LIMIT_SIGN_IN_IP_MAX: raw })).toThrow(
      "AUTH_RATE_LIMIT_SIGN_IN_IP_MAX must be a positive whole number",
    );
  });
});
