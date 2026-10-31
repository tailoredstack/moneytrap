import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { migrate } from "@moneytrap/adapter-postgres";
import { createRedisConnection, createRedisRateLimitCounter, type RateLimitCounter } from "@moneytrap/adapter-redis";
import { Elysia } from "elysia";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { authRoutes } from "../http/auth";
import { createAuth } from "./config";
import type { AuthMailer } from "./mailer";
import type { RateLimitPolicy } from "./rate-limit";

// Runs against real Postgres and Redis when both TEST_DATABASE_URL and TEST_REDIS_URL are set (CI provides them).
const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const describeWithStores = databaseUrl && redisUrl ? describe : describe.skip;

const VALID_PASSWORD = "correct horse battery";
const WRONG_PASSWORD = "wrong password!";
const ORIGIN = "https://moneytrap.test";
const SECRET = "test-secret-at-least-32-characters-long";

// A limit high enough that the test never reaches it. Each test tightens only the dimension it checks.
const LOOSE = { max: 1000, window: 900 };
const LOOSE_RECOVERY = { max: 1000, window: 3600 };

function policyWith(
  signIn: { perIp?: { max: number; window: number }; perIdentity?: { max: number; window: number } },
  recovery: { perIp?: { max: number; window: number }; perIdentity?: { max: number; window: number } } = {},
): RateLimitPolicy {
  return {
    signIn: { perIp: LOOSE, perIdentity: LOOSE, ...signIn },
    recovery: { perIp: LOOSE_RECOVERY, perIdentity: LOOSE_RECOVERY, ...recovery },
  };
}

describeWithStores("auth rate limiting against Postgres and Redis (TP-W2-014, TP-W2-048)", () => {
  let schema: string;
  let pool: Pool;
  let db: Kysely<unknown>;
  let redis: ReturnType<typeof createRedisConnection>;
  let prefix: string;
  let counter: RateLimitCounter;

  beforeEach(async () => {
    schema = `ratelimit_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`create schema "${schema}"`);
    await admin.end();

    pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    db = new Kysely<unknown>({ dialect: new PostgresDialect({ pool }) });
    await migrate(db);

    redis = createRedisConnection(redisUrl as string);
    prefix = `ratelimit_test_${crypto.randomUUID().replaceAll("-", "")}:`;
    counter = createRedisRateLimitCounter(redis, prefix);
  });

  afterEach(async () => {
    await db.destroy();
    const admin = new Pool({ connectionString: databaseUrl });
    await admin.query(`drop schema if exists "${schema}" cascade`);
    await admin.end();
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
  });

  const mailer: AuthMailer = {
    async sendVerification() {},
    async sendPasswordReset() {},
  };

  function authWith(policy: RateLimitPolicy, shared: RateLimitCounter = counter, trustedProxies: string[] = []) {
    return createAuth({
      pool,
      secret: SECRET,
      baseURL: ORIGIN,
      mailer,
      trustedProxies,
      rateLimitCounter: shared,
      rateLimitPolicy: policy,
    });
  }

  type Auth = ReturnType<typeof authWith>;

  function post(auth: Auth, path: string, body: unknown, ip: string) {
    return auth.handler(
      new Request(`${ORIGIN}/api/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": ip },
        body: JSON.stringify(body),
      }),
    );
  }

  const login = (auth: Auth, email: string, password: string, ip: string) =>
    post(auth, "sign-in/email", { email, password }, ip);
  const requestReset = (auth: Auth, email: string, ip: string) =>
    post(auth, "request-password-reset", { email, redirectTo: `${ORIGIN}/reset` }, ip);

  test("TP-W2-014: wrong passwords for one identity are limited per identity, even from changing IPs", async () => {
    const auth = authWith(policyWith({ perIdentity: { max: 3, window: 900 } }));

    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await login(auth, "ada@example.test", WRONG_PASSWORD, `10.0.0.${i + 1}`)).status);
    }

    expect(statuses.slice(0, 3).every((status) => status !== 429)).toBe(true);
    expect(statuses[3]).toBe(429);
  });

  test("TP-W2-014: once an identity is limited, the correct password is also refused from a new IP", async () => {
    const auth = authWith(policyWith({ perIdentity: { max: 2, window: 900 } }));
    for (let i = 0; i < 2; i++) await login(auth, "ada@example.test", WRONG_PASSWORD, `10.0.1.${i + 1}`);

    const response = await login(auth, "ada@example.test", VALID_PASSWORD, "10.0.1.99");

    expect(response.status).toBe(429);
  });

  test("TP-W2-014: wrong passwords from one IP are limited per IP, across identities", async () => {
    // ipMax is 5, above Better Auth's built-in 3-per-10-seconds rule for /sign-in*, so only the policy can refuse the 6th.
    const auth = authWith(policyWith({ perIp: { max: 5, window: 600 } }));

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      statuses.push((await login(auth, `user${i}@example.test`, WRONG_PASSWORD, "10.0.2.1")).status);
    }

    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  test("TP-W2-048: recovery requests for one identity are limited per identity", async () => {
    const auth = authWith(policyWith({}, { perIdentity: { max: 1, window: 3600 } }));

    const first = await requestReset(auth, "ada@example.test", "10.0.3.1");
    const second = await requestReset(auth, "ada@example.test", "10.0.3.2");

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });

  test("TP-W2-048: recovery responses for a known and an unknown identity are the same, before and after the limit", async () => {
    const auth = authWith(policyWith({}, { perIdentity: { max: 1, window: 3600 } }));
    await auth.api.signUpEmail({ body: { email: "ada@example.test", password: VALID_PASSWORD, name: "Ada" } });

    const knownFirst = await requestReset(auth, "ada@example.test", "10.0.4.1");
    const knownLimited = await requestReset(auth, "ada@example.test", "10.0.4.2");
    const unknownFirst = await requestReset(auth, "nobody@example.test", "10.0.4.3");
    const unknownLimited = await requestReset(auth, "nobody@example.test", "10.0.4.4");

    expect(knownFirst.status).toBe(200);
    expect(knownLimited.status).toBe(429);
    expect(unknownFirst.status).toBe(knownFirst.status);
    expect(unknownLimited.status).toBe(knownLimited.status);
    expect(await unknownLimited.text()).toEqual(await knownLimited.text());
  });

  test("TP-W2-048: recovery requests from one IP are limited per IP, across identities", async () => {
    const auth = authWith(policyWith({}, { perIp: { max: 2, window: 3600 } }));

    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await requestReset(auth, `user${i}@example.test`, "10.0.5.1")).status);

    expect(statuses[2]).toBe(429);
  });

  test("the counts live in Redis, so a second process sharing the counter sees the same limit", async () => {
    const policy = policyWith({ perIdentity: { max: 2, window: 900 } });
    const first = authWith(policy);
    for (let i = 0; i < 2; i++) await login(first, "ada@example.test", WRONG_PASSWORD, `10.0.6.${i + 1}`);

    const second = authWith(policy, createRedisRateLimitCounter(redis, prefix));
    const response = await login(second, "ada@example.test", WRONG_PASSWORD, "10.0.6.99");

    expect(response.status).toBe(429);
  });

  // Proxies append the address they received the request from. Better Auth takes the rightmost untrusted address.
  // Client A sends three requests with spoofed leftmost entries, and client B sends one. Only A's bucket fills. B must
  // still get 401, which fails if the trusted-proxy config is removed and the unresolved header falls into a shared bucket.
  test("behind a trusted proxy, the per-IP bucket follows the appended client address, not spoofed entries", async () => {
    const auth = authWith(policyWith({ perIp: { max: 2, window: 600 } }), counter, ["10.0.0.0/8"]);
    const send = (forwarded: string, email: string) =>
      auth.handler(
        new Request(`${ORIGIN}/api/auth/sign-in/email`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": forwarded },
          body: JSON.stringify({ email, password: WRONG_PASSWORD }),
        }),
      );

    const clientA = [
      await send("198.51.100.1, 203.0.113.7", "a1@example.test"),
      await send("198.51.100.2, 203.0.113.7", "a2@example.test"),
      await send("198.51.100.3, 203.0.113.7", "a3@example.test"),
    ].map((response) => response.status);
    const clientB = (await send("198.51.100.9, 203.0.113.8", "b1@example.test")).status;

    expect(clientA).toEqual([401, 401, 429]);
    expect(clientB).toBe(401);
  });

  // Without trusted proxies, a client must not choose its own bucket by sending x-forwarded-for. The server replaces
  // the header with the socket peer address before Better Auth reads it. Requests here all come from 127.0.0.1.
  test("without trusted proxies, rotating x-forwarded-for does not open new per-IP buckets", async () => {
    const real = authWith(policyWith({ perIp: { max: 2, window: 600 } }));
    // Records what Better Auth receives. Each request must carry the socket peer, not the client's header and not nothing.
    const seen: Array<string | null> = [];
    const auth = {
      handler: (request: Request) => {
        seen.push(request.headers.get("x-forwarded-for"));
        return real.handler(request);
      },
    };
    const app = new Elysia().use(authRoutes(auth, { trustProxy: false })).listen({ port: 0, hostname: "127.0.0.1" });
    try {
      const url = `http://127.0.0.1:${app.server?.port}/api/auth/sign-in/email`;
      const statuses: number[] = [];
      for (let i = 1; i <= 3; i++) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN, "x-forwarded-for": `198.51.100.${i}` },
          body: JSON.stringify({ email: `u${i}@example.test`, password: WRONG_PASSWORD }),
        });
        statuses.push(response.status);
      }

      expect(statuses).toEqual([401, 401, 429]);
      expect(seen).toEqual(["127.0.0.1", "127.0.0.1", "127.0.0.1"]);
    } finally {
      app.stop();
    }
  });

  // A store outage must fail closed with a coded 503, not an opaque 500.
  test("a Redis outage refuses login with a coded 503 instead of an opaque error", async () => {
    const down: RateLimitCounter = {
      increment: async () => {
        throw new Error("connect ECONNREFUSED");
      },
      count: async () => {
        throw new Error("connect ECONNREFUSED");
      },
    };
    const auth = authWith(policyWith({}), down);

    const response = await login(auth, "ada@example.test", WRONG_PASSWORD, "10.0.7.1");

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("RATE_LIMIT_UNAVAILABLE");
  });
});
