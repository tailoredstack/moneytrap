import { Elysia } from "elysia";
import { Kysely, Migrator, PostgresDialect } from "kysely";
import { Pool } from "pg";
import scriptPath from "../../node_modules/.cache/moneytrap-binary/binary-page.js" with { type: "file" };
import pagePath from "./index.html" with { type: "file" };

const migrations = {
  "0001_binary_spike": {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable("binary_spike_probe")
        .ifNotExists()
        .addColumn("id", "integer", (column) => column.primaryKey())
        .execute();
    },
    async down(db: Kysely<unknown>) {
      await db.schema.dropTable("binary_spike_probe").ifExists().execute();
    },
  },
};

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for --migrate");

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
  });
  try {
    const result = await new Migrator({
      db,
      provider: { getMigrations: async () => migrations },
    }).migrateToLatest();
    for (const migration of result.results ?? []) {
      console.log(`${migration.migrationName}: ${migration.status}`);
    }
    if (result.error) throw result.error;
  } finally {
    await db.destroy();
  }
}

if (process.argv.includes("--migrate")) {
  await migrate();
} else {
  const port = Number(process.env.PORT ?? 3000);
  new Elysia()
    .get("/health", () => "ok")
    .get(
      "/",
      async () =>
        new Response(Bun.file(String(pagePath)), {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    )
    .get(
      "/app.js",
      () =>
        new Response(Bun.file(scriptPath), {
          headers: { "content-type": "text/javascript; charset=utf-8" },
        }),
    )
    .listen({ hostname: "127.0.0.1", port });
  console.log(`Listening on 127.0.0.1:${port}`);
}
