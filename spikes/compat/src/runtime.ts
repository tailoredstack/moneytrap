import { openapi } from "@elysiajs/openapi";
import { trace } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { getMigrations } from "better-auth/db/migration";
import { Queue, Worker } from "bullmq";
import { Elysia, status, t, ValidationError } from "elysia";
import { Kysely, PostgresDialect } from "kysely";
import { Migrator } from "kysely/migration";
import { Pool } from "pg";
import { createClient } from "redis";
import { createAuth } from "./auth.ts";
import { migrationProvider } from "./migrations.ts";

export type RuntimeOptions = {
  databaseUrl: string;
  redisUrl: string;
  secret: string;
  baseURL: string;
  otlpUrl?: string | undefined;
};

export type Runtime = {
  app: { fetch: (request: Request) => Response | Promise<Response> };
  baseURL: string;
  migrate: () => Promise<void>;
  close: () => Promise<void>;
};

class DomainError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
  }
}

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const pool = new Pool({ connectionString: options.databaseUrl });
  const db = new Kysely<{ probe_items: { id: string; name: string; amount: number } }>({
    dialect: new PostgresDialect({ pool }),
  });
  const auth = createAuth({ pool, secret: options.secret, baseURL: options.baseURL });

  const redis = createClient({ url: options.redisUrl });
  await redis.connect();

  const redisUrl = new URL(options.redisUrl);
  const connection = {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    maxRetriesPerRequest: null,
  };
  const queue = new Queue("compat", { connection });
  const worker = new Worker("compat", async (job) => ({ doubled: (job.data as { n: number }).n * 2 }), { connection });

  const tracerProvider = new BasicTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(new OTLPTraceExporter({ url: options.otlpUrl ?? "http://127.0.0.1:4318/v1/traces" })),
    ],
  });
  trace.setGlobalTracerProvider(tracerProvider);
  const tracer = trace.getTracer("moneytrap-compat");

  // Plugin hooks registered with the default (local) scope must not reach other routes.
  const localPlugin = new Elysia()
    .onAfterHandle(({ set }) => {
      set.headers["x-compat-plugin"] = "local";
    })
    .get("/probe/plugin", () => "ok");

  const app = new Elysia()
    .use(openapi())
    .onError(({ error, set }) => {
      if (error instanceof DomainError) {
        set.status = error.httpStatus;
        return { error: { code: error.code } };
      }
      if (error instanceof ValidationError) {
        set.status = 400;
        return { error: { code: "VALIDATION_FAILED" } };
      }
      set.status = 500;
      return { error: { code: "INTERNAL" } };
    })
    .get("/health", () => "ok")
    .use(localPlugin)
    .get("/probe/after-plugin", () => "ok")
    .get("/probe/conflict", () => {
      throw new DomainError("ALREADY_EXISTS", 409);
    })
    .post(
      "/probe/items",
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          amount: t.Integer(),
        }),
      },
      async ({ body }) => {
        const id = crypto.randomUUID();
        await db
          .insertInto("probe_items")
          .values({ id, ...body })
          .execute();
        return status(201, { id, ...body });
      },
    )
    .get("/probe/items", async () => ({
      items: await db.selectFrom("probe_items").select(["id", "name", "amount"]).execute(),
    }))
    .put("/probe/cache/:key", { body: t.Object({ value: t.String() }) }, async ({ params, body }) => {
      await redis.set(params.key, body.value, { EX: 60 });
      return status(204);
    })
    .get("/probe/cache/:key", async ({ params }) => ({ value: await redis.get(params.key) }))
    .post("/probe/jobs", { body: t.Object({ n: t.Integer() }) }, async ({ body }) => {
      const job = await queue.add("probe", body);
      return status(202, { id: job.id });
    })
    .get("/probe/jobs/:id", async ({ params }) => {
      const job = await queue.getJob(params.id);
      return { state: job ? await job.getState() : "missing" };
    })
    .get("/probe/trace", () => {
      tracer.startActiveSpan("compat.probe", (span) => span.end());
      return "ok";
    })
    .all("/api/auth/*", ({ request }) => auth.handler(request));

  const migrateAll = async () => {
    const migrator = new Migrator({ db: db as Kysely<unknown>, provider: migrationProvider });
    const { error } = await migrator.migrateToLatest();
    if (error) throw error;
    const { runMigrations } = await getMigrations(auth.options);
    await runMigrations();
  };

  return {
    app,
    baseURL: options.baseURL,
    migrate: migrateAll,
    close: async () => {
      await worker.close();
      await queue.close();
      await redis.close();
      await tracerProvider.shutdown();
      await db.destroy();
    },
  };
}
