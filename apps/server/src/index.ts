import {
  createClickReportStore,
  createMembershipReader,
  createNetworkAccountStore,
  createProgramApprovalStore,
  createRouteSource,
  createStatementStore,
  migrate,
} from "@moneytrap/adapter-postgres";
import {
  createClickQueue,
  createRedisConnection,
  createRedisRateLimitCounter,
  createRouteCache,
} from "@moneytrap/adapter-redis";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { notifierFromEnv } from "./adapters/notifier-from-env";
import { createSecretBox } from "./adapters/secret-box";
import { secretKeyringFromEnv } from "./adapters/secret-box-from-env";
import { createApp } from "./app";
import { createAuth, trustedOrigins } from "./auth/config";
import { notifierMailer } from "./auth/mailer";
import { rateLimitPolicy } from "./auth/rate-limit";
import { authenticate } from "./http/auth";
import { apiRoutes } from "./http/routes";
import { randomIds, systemClock } from "./system";

// The only runtime inputs are environment variables and argv. Migrations are not run on boot; `--migrate` runs them
// and exits, so operators control schema changes (Blueprint §1).
async function runMigrations(): Promise<void> {
  const connectionString = Bun.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for --migrate");

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
  try {
    const result = await migrate(db);
    const applied = (result.results ?? []).filter((migration) => migration.status === "Success");
    if (applied.length === 0) console.log("No pending migrations.");
    for (const migration of applied) console.log(`applied ${migration.migrationName}`);
  } finally {
    await db.destroy();
  }
}

function requiredEnv(name: string): string {
  const value = Bun.env[name];
  if (!value) throw new Error(`${name} is required to serve`);
  return value;
}

function serve(): void {
  const port = Number(Bun.env.PORT ?? 3000);
  const hostname = Bun.env.HOST ?? "127.0.0.1";
  // Better Auth checks the schema when it starts, so an unreachable database logs an error at boot. The server
  // still listens, and requests to /api/auth fail until the database and migrations are in place.
  // Comma-separated CIDRs of the proxies in front of this server, for example 10.0.0.0/8. Leave unset when no proxy
  // sits in front, so a client cannot choose its own IP for rate limits.
  const trustedProxies = (Bun.env.AUTH_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((cidr) => cidr.trim())
    .filter(Boolean);
  // Comma-separated origins Better Auth trusts besides BASE_URL, for example http://localhost:3000,http://localhost:5190.
  // An entry that is not an http or https origin stops startup.
  const extraOrigins = trustedOrigins(Bun.env.TRUSTED_ORIGINS);
  // One Redis connection serves the rate limits, the route view cache, and the click queue.
  const redis = createRedisConnection(requiredEnv("REDIS_URL"));
  const auth = createAuth({
    pool: new Pool({ connectionString: requiredEnv("DATABASE_URL") }),
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    baseURL: requiredEnv("BASE_URL"),
    // Login and recovery limits are shared across instances, so their counters live in Redis (WP-2.14).
    rateLimitCounter: createRedisRateLimitCounter(redis),
    rateLimitPolicy: rateLimitPolicy(Bun.env),
    trustedProxies,
    trustedOrigins: extraOrigins,
    // SMTP when SMTP_HOST is set (Mailpit locally). Otherwise the dev sink keeps messages in memory, and verification
    // and reset links are not delivered outside this process. There is no production email provider yet.
    mailer: notifierMailer(notifierFromEnv(Bun.env)),
  });

  // Reads for the report routes. They use their own pool, separate from Better Auth's.
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: requiredEnv("DATABASE_URL") }) }),
  });
  const reports = {
    clicks: createClickReportStore(db),
    clock: systemClock,
    principal: (headers: Headers) => authenticate(auth, headers, createMembershipReader(db)),
  };
  // The visitor redirect (ADR-007). A cache miss reads the primary; a click is enqueued after the answer, never awaited.
  // The approval request (API-035). It reads the same principal as the reports, and writes through the same database.
  const approvals = {
    db,
    store: createProgramApprovalStore(db),
    clock: systemClock,
    ids: randomIds,
    principal: reports.principal,
  };
  const networkAccounts = {
    db,
    store: createNetworkAccountStore(db),
    secretBox: createSecretBox(
      secretKeyringFromEnv({
        NETWORK_SECRET_ACTIVE_KEY_ID: Bun.env.NETWORK_SECRET_ACTIVE_KEY_ID,
        NETWORK_SECRET_KEYS: Bun.env.NETWORK_SECRET_KEYS,
      }),
    ),
    clock: systemClock,
    ids: randomIds,
    principal: (headers: Headers) => authenticate(auth, headers, createMembershipReader(db)),
  };
  const redirect = {
    cache: createRouteCache(redis),
    source: createRouteSource(db),
    clicks: createClickQueue(redis),
    clock: systemClock,
    onClickError: (error: unknown) => console.error("click enqueue failed", error),
  };

  createApp({ clock: systemClock, ids: randomIds, readiness: [] })
    .use(
      apiRoutes(auth, { trustProxy: trustedProxies.length > 0 }, reports, redirect, approvals, networkAccounts, {
        store: createStatementStore(db),
        principal: reports.principal,
      }),
    )
    .listen({ hostname, port });
  console.log(`Listening on ${hostname}:${port}`);
}

if (process.argv.includes("--migrate")) {
  await runMigrations();
} else {
  serve();
}
