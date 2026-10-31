import { describe, expect, test } from "bun:test";
import {
  AUTH_RATE_LIMIT_POLICY,
  ipRateLimitRules,
  ipRateLimitStorage,
  type RateLimitCounter,
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
      await refuseIfSpent(counter, SIGN_IN, { email: EMAIL });
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: EMAIL }))).toBe(false);
  });

  test("refuses once the email has used up its failed attempts", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: EMAIL });
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: EMAIL }))).toBe(true);
  });

  test("allows the failures up to the limit, then refuses the next attempt", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max - 1; i++) {
      await recordFailedSignIn(counter, { email: EMAIL });
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: EMAIL }))).toBe(false);
  });

  test("treats the same email in another case or with spaces as one identity", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: "Ada@Example.test" });
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: " ada@example.TEST " }))).toBe(true);
  });

  test("one identity being limited does not limit another", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: EMAIL });
    }

    expect(await refuses(refuseIfSpent(counter, SIGN_IN, { email: "grace@example.test" }))).toBe(false);
  });

  test("ignores a failed sign-in with no email", async () => {
    const counter = memoryCounter();

    await recordFailedSignIn(counter, {});

    expect(counter.counts.size).toBe(0);
  });
});

describe("recovery per-identity limit counts every request", () => {
  test("refuses the request after the recovery budget is spent", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.recovery.perIdentity.max; i++) {
      await refuseIfSpent(counter, RECOVERY, { email: EMAIL });
    }

    expect(await refuses(refuseIfSpent(counter, RECOVERY, { email: EMAIL }))).toBe(true);
  });

  test("sign-in failures and recovery requests count separately for the same email", async () => {
    const counter = memoryCounter();
    for (let i = 0; i < AUTH_RATE_LIMIT_POLICY.signIn.perIdentity.max; i++) {
      await recordFailedSignIn(counter, { email: EMAIL });
    }

    expect(await refuses(refuseIfSpent(counter, RECOVERY, { email: EMAIL }))).toBe(false);
  });
});

describe("paths and bodies outside the rules", () => {
  test("ignores paths that are not login or recovery", async () => {
    const counter = memoryCounter();

    await refuseIfSpent(counter, "/sign-up/email", { email: EMAIL });

    expect(counter.counts.size).toBe(0);
  });

  test("skips a request without an email so Better Auth's own validation answers it", async () => {
    const counter = memoryCounter();

    await refuseIfSpent(counter, RECOVERY, {});

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
