import { migrate } from "@moneytrap/adapter-postgres";
import { createRedisConnection, createRedisRateLimitCounter } from "@moneytrap/adapter-redis";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { NotifyDev } from "./adapters/notify-dev";
import { createApp } from "./app";
import { serveWebAsset } from "./assets";
import { createAuth } from "./auth/config";
import { notifierMailer } from "./auth/mailer";
import { rateLimitPolicy } from "./auth/rate-limit";
import { authRoutes } from "./http/auth";
import { sessionRoutes } from "./http/sessions";
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
  const auth = createAuth({
    pool: new Pool({ connectionString: requiredEnv("DATABASE_URL") }),
    secret: requiredEnv("BETTER_AUTH_SECRET"),
    baseURL: requiredEnv("BASE_URL"),
    // Login and recovery limits are shared across instances, so their counters live in Redis (WP-2.14).
    rateLimitCounter: createRedisRateLimitCounter(createRedisConnection(requiredEnv("REDIS_URL"))),
    rateLimitPolicy: rateLimitPolicy(Bun.env),
    trustedProxies,
    // Dev sink: messages stay in memory until the production Notifier adapter lands. Verification and
    // reset links are not delivered outside this process yet.
    mailer: notifierMailer(new NotifyDev()),
  });

  createApp({ clock: systemClock, ids: randomIds, readiness: [] })
    .use(authRoutes(auth, { trustProxy: trustedProxies.length > 0 }))
    .use(sessionRoutes(auth))
    .get("/api/health", () => ({ status: "ok" }))
    .get("/*", ({ request }) => {
      const { pathname } = new URL(request.url);
      // The API namespace never falls through to the shell, so a mistyped API path gets a 404.
      if (pathname === "/api" || pathname.startsWith("/api/")) return notFound();
      return serveWebAsset(pathname) ?? notFound();
    })
    .listen({ hostname, port });
  console.log(`Listening on ${hostname}:${port}`);
}

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
}

if (process.argv.includes("--migrate")) {
  await runMigrations();
} else {
  serve();
}
