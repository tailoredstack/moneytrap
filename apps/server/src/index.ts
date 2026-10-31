import { migrate } from "@moneytrap/adapter-postgres";
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { createApp } from "./app";
import { serveWebAsset } from "./assets";
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

function serve(): void {
  const port = Number(Bun.env.PORT ?? 3000);
  const hostname = Bun.env.HOST ?? "127.0.0.1";

  createApp({ clock: systemClock, ids: randomIds })
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
