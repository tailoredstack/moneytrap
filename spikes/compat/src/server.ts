import { createRuntime } from "./runtime.ts";

// Entry point for the compiled binary: `--migrate` runs migrations and exits; otherwise serve.
function required(name: string): string {
  const value = Bun.env[name];
  if (!value) {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value;
}

const port = Number(Bun.env.PORT ?? 3000);
const runtime = await createRuntime({
  databaseUrl: required("DATABASE_URL"),
  redisUrl: Bun.env.REDIS_URL ?? "redis://127.0.0.1:6380",
  secret: required("BETTER_AUTH_SECRET"),
  baseURL: Bun.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${port}`,
  otlpUrl: Bun.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
});

if (Bun.argv.includes("--migrate")) {
  await runtime.migrate();
  await runtime.close();
  process.exit(0);
}

Bun.serve({ port, fetch: runtime.app.fetch });
console.log(`moneytrap-compat listening on ${port}`);
