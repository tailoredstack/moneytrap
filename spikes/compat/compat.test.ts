import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createRuntime, type Runtime } from "./src/runtime.ts";

// Runs every library check twice: in-process under `bun test`, then against the
// compiled binary. Set COMPAT_DATABASE_URL and COMPAT_REDIS_URL to run them; without
// COMPAT_DATABASE_URL the suite is skipped so the root `bun test` in CI stays green.
const databaseUrl = Bun.env.COMPAT_DATABASE_URL;
const redisUrl = Bun.env.COMPAT_REDIS_URL ?? "redis://127.0.0.1:6380";
const secret = "compat-spike-secret-compat-spike-secret";
const binary = resolve(import.meta.dir, "dist/moneytrap-compat");

type Collector = { url: string; bodies: string[]; stop: () => void };

// Asks the OS for an unused port by binding port 0 and releasing it.
function freePort(): number {
  const probe = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 404 }) });
  const port = probe.port;
  probe.stop(true);
  if (port === undefined) throw new Error("could not allocate a local port");
  return port;
}

function startCollector(): Collector {
  const bodies: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/v1/traces") {
        bodies.push(Buffer.from(await request.arrayBuffer()).toString("latin1"));
      }
      return new Response(null, { status: 200 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}/v1/traces`, bodies, stop: () => server.stop(true) };
}

async function json(response: Response) {
  // biome-ignore lint/suspicious/noExplicitAny: the spike decodes arbitrary response bodies
  return (await response.json()) as Record<string, any>;
}

function defineChecks(mode: string, baseUrl: () => string, collector: () => Collector) {
  const url = (path: string) => `${baseUrl()}${path}`;
  const email = `compat-${randomUUID()}@example.test`;
  let cookie = "";

  test(`${mode}: serves health with no plugin header leakage`, async () => {
    const response = await fetch(url("/health"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("x-compat-plugin")).toBeNull();
  });

  test(`${mode}: Elysia validates request bodies and maps errors`, async () => {
    const invalid = await fetch(url("/probe/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", amount: 1 }),
    });
    expect(invalid.status).toBe(400);
    expect((await json(invalid)).error.code).toBe("VALIDATION_FAILED");

    const conflict = await fetch(url("/probe/conflict"));
    expect(conflict.status).toBe(409);
    expect((await json(conflict)).error.code).toBe("ALREADY_EXISTS");
  });

  test(`${mode}: plugin hooks stay local to the plugin`, async () => {
    const inside = await fetch(url("/probe/plugin"));
    expect(inside.status).toBe(200);
    expect(inside.headers.get("x-compat-plugin")).toBe("local");
    // Registered on the root app after the plugin is used: must not inherit its hook.
    const outside = await fetch(url("/probe/after-plugin"));
    expect(outside.status).toBe(200);
    expect(outside.headers.get("x-compat-plugin")).toBeNull();
  });

  test(`${mode}: Elysia emits OpenAPI output for its routes`, async () => {
    const response = await fetch(url("/openapi/json"));
    expect(response.status).toBe(200);
    const document = await json(response);
    expect(document.openapi).toMatch(/^3\./);
    expect(document.paths["/probe/items"]).toBeDefined();
  });

  test(`${mode}: Kysely writes and reads PostgreSQL through pg`, async () => {
    const name = `item-${randomUUID()}`;
    const created = await fetch(url("/probe/items"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, amount: 42 }),
    });
    expect(created.status).toBe(201);
    const id = (await json(created)).id;
    const listed = await json(await fetch(url("/probe/items")));
    expect(listed.items.some((item: { id: string; amount: number }) => item.id === id && item.amount === 42)).toBe(
      true,
    );
  });

  test(`${mode}: Better Auth signs up and resolves a session through the Elysia mount`, async () => {
    const signUp = await fetch(url("/api/auth/sign-up/email"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl() },
      body: JSON.stringify({ name: "Compat", email, password: "correct-horse-battery" }),
    });
    expect(signUp.status).toBe(200);
    cookie = (signUp.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
    expect(cookie).toContain("better-auth");

    const session = await json(await fetch(url("/api/auth/get-session"), { headers: { cookie } }));
    expect(session.user.email).toBe(email);
  });

  test(`${mode}: Better Auth organization plugin creates an organization`, async () => {
    const response = await fetch(url("/api/auth/organization/create"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl(), cookie },
      body: JSON.stringify({ name: "Compat Org", slug: `compat-${randomUUID()}` }),
    });
    expect(response.status).toBe(200);
    expect((await json(response)).id).toBeString();
  });

  test(`${mode}: Better Auth two-factor plugin enables TOTP`, async () => {
    const response = await fetch(url("/api/auth/two-factor/enable"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl(), cookie },
      body: JSON.stringify({ password: "correct-horse-battery" }),
    });
    expect(response.status).toBe(200);
    expect((await json(response)).totpURI).toStartWith("otpauth://");
  });

  test(`${mode}: Better Auth API key plugin issues a key that resolves a session`, async () => {
    const created = await fetch(url("/api/auth/api-key/create"), {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl(), cookie },
      body: JSON.stringify({ name: "compat" }),
    });
    expect(created.status).toBe(200);
    const key = (await json(created)).key;
    expect(key).toBeString();

    const session = await json(await fetch(url("/api/auth/get-session"), { headers: { "x-api-key": key } }));
    expect(session.user.email).toBe(email);
  });

  test(`${mode}: Redis client round-trips a cache value`, async () => {
    const key = `compat:${randomUUID()}`;
    const put = await fetch(url(`/probe/cache/${key}`), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "warm" }),
    });
    expect(put.status).toBe(204);
    expect((await json(await fetch(url(`/probe/cache/${key}`)))).value).toBe("warm");
  });

  test(`${mode}: BullMQ processes a job enqueued from a request`, async () => {
    const enqueued = await fetch(url("/probe/jobs"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ n: 7 }),
    });
    expect(enqueued.status).toBe(202);
    const { id } = await json(enqueued);

    let state = "unknown";
    for (let attempt = 0; attempt < 100 && state !== "completed"; attempt++) {
      state = (await json(await fetch(url(`/probe/jobs/${id}`)))).state;
      if (state !== "completed") await Bun.sleep(50);
    }
    expect(state).toBe("completed");
  });

  test(`${mode}: OpenTelemetry exports a span to an OTLP HTTP collector`, async () => {
    const before = collector().bodies.length;
    expect((await fetch(url("/probe/trace"))).status).toBe(200);
    for (let attempt = 0; attempt < 100 && collector().bodies.length === before; attempt++) {
      await Bun.sleep(20);
    }
    expect(
      collector()
        .bodies.slice(before)
        .some((body) => body.includes("compat.probe")),
    ).toBe(true);
  });
}

describe.skipIf(!databaseUrl)("bun test", () => {
  let runtime: Runtime;
  let server: ReturnType<typeof Bun.serve>;
  let collectorServer: Collector;

  beforeAll(async () => {
    collectorServer = startCollector();
    // Bind the port first: Better Auth checks request origins against its base URL.
    let app: Runtime["app"] | undefined;
    server = Bun.serve({ port: 0, fetch: (request) => app?.fetch(request) ?? new Response(null, { status: 503 }) });
    runtime = await createRuntime({
      databaseUrl: databaseUrl as string,
      redisUrl,
      secret,
      baseURL: `http://127.0.0.1:${server.port}`,
      otlpUrl: collectorServer.url,
    });
    app = runtime.app;
    await runtime.migrate();
  });

  afterAll(async () => {
    server?.stop(true);
    await runtime?.close();
    collectorServer?.stop();
  });

  defineChecks(
    "bun test",
    () => runtime.baseURL,
    () => collectorServer,
  );
});

describe.skipIf(!databaseUrl)("compiled binary", () => {
  let port = 0;
  let cleanDir = "";
  let cleanBinary = binary;
  let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
  let collectorServer: Collector;

  beforeAll(async () => {
    const build = Bun.spawnSync([process.execPath, "run", resolve(import.meta.dir, "build.ts")]);
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    cleanDir = await mkdtemp(resolve(tmpdir(), "moneytrap-compat-"));
    cleanBinary = resolve(cleanDir, "moneytrap-compat");
    await copyFile(binary, cleanBinary);
    collectorServer = startCollector();

    const baseEnv = {
      PATH: "/usr/bin:/bin",
      DATABASE_URL: databaseUrl as string,
      REDIS_URL: redisUrl,
      BETTER_AUTH_SECRET: secret,
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: collectorServer.url,
    };
    // Migration does not serve HTTP, so it gets a placeholder base URL.
    const migrated = Bun.spawnSync([cleanBinary, "--migrate"], {
      cwd: cleanDir,
      env: { ...baseEnv, BETTER_AUTH_URL: "http://127.0.0.1" },
    });
    expect(migrated.exitCode, migrated.stderr.toString()).toBe(0);

    // Pick the port just before spawning. The gap is milliseconds, but another process could still take it there.
    port = freePort();
    serverProcess = Bun.spawn([cleanBinary], {
      cwd: cleanDir,
      env: { ...baseEnv, BETTER_AUTH_URL: `http://127.0.0.1:${port}`, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    let ready = false;
    for (let attempt = 0; attempt < 250 && !ready; attempt++) {
      if (serverProcess.exitCode !== null) break;
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/health`)).status === 200;
      } catch {
        // Not listening yet; retry below.
      }
      if (!ready) await Bun.sleep(20);
    }
    expect(ready, "compiled binary did not become ready").toBe(true);
  });

  afterAll(async () => {
    serverProcess?.kill();
    collectorServer?.stop();
    if (cleanDir) await rm(cleanDir, { recursive: true, force: true });
  });

  defineChecks(
    "compiled binary",
    () => `http://127.0.0.1:${port}`,
    () => collectorServer,
  );
});
