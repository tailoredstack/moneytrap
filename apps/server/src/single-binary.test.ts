import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";

// TP-W1-036, TP-W1-037: the compiled binary is the deployable unit, so these tests run it from a
// directory outside the repository with no Bun on PATH.
const repo = resolve(import.meta.dir, "../../..");
const binary = resolve(repo, "dist/moneytrap");
const webDist = resolve(repo, "apps/web/dist");
const port = 18_000 + Math.floor(Math.random() * 20_000);
const databaseUrl = Bun.env.TEST_DATABASE_URL;
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let cleanDir = "";
let cleanBinary = binary;

beforeAll(async () => {
  const build = Bun.spawnSync([process.execPath, "run", resolve(repo, "apps/server/build.ts")], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(build.exitCode, build.stderr.toString()).toBe(0);
  cleanDir = await mkdtemp(resolve(tmpdir(), "moneytrap-binary-"));
  cleanBinary = resolve(cleanDir, "moneytrap");
  await copyFile(binary, cleanBinary);
});

afterAll(async () => {
  serverProcess?.kill();
  if (cleanDir) await rm(cleanDir, { recursive: true, force: true });
});

async function startServer(): Promise<string> {
  serverProcess = Bun.spawn([cleanBinary], {
    cwd: cleanDir,
    env: {
      PORT: String(port),
      PATH: "/usr/bin:/bin",
      // Better Auth config is required at boot. The pool connects lazily, so this database is never reached here.
      DATABASE_URL: "postgres://unused.invalid:5432/moneytrap",
      BETTER_AUTH_SECRET: "binary-test-secret-at-least-32-characters",
      BASE_URL: `http://127.0.0.1:${port}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 250; attempt++) {
    try {
      await fetch(`${base}/api/health`);
      return base;
    } catch {
      await Bun.sleep(20);
    }
  }
  throw new Error("compiled binary did not start listening");
}

test("compiled binary serves the API, the web shell, and hashed assets", async () => {
  expect(existsSync(binary)).toBe(true);
  const base = await startServer();

  const health = await fetch(`${base}/api/health`);
  expect(health.status).toBe(200);
  expect(health.headers.get("x-request-id")).toBeTruthy();

  // The request reaches Better Auth, not the shell. With no database here it answers 500, never 404.
  const session = await fetch(`${base}/api/auth/get-session`);
  expect(session.status).not.toBe(404);
  expect(await health.json()).toEqual({ status: "ok" });

  const shell = await fetch(`${base}/`);
  expect(shell.status).toBe(200);
  expect(shell.headers.get("content-type")).toContain("text/html");
  const html = await shell.text();
  expect(html).toContain('<div id="root"></div>');

  const scriptSrc = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1] ?? "";
  expect(scriptSrc).toMatch(/^\/assets\/.+\.js$/);
  const served = await fetch(`${base}${scriptSrc}`);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-type")).toContain("javascript");
  expect(served.headers.get("cache-control")).toContain("immutable");
  const built = await readFile(resolve(webDist, scriptSrc.slice(1)), "utf8");
  expect(await served.text()).toBe(built);

  const route = await fetch(`${base}/overview?page=2`);
  expect(route.status).toBe(200);
  expect(await route.text()).toContain('<div id="root"></div>');

  const missingAsset = await fetch(`${base}/assets/no-such-bundle`);
  expect(missingAsset.status).toBe(404);
  expect(await missingAsset.text()).not.toContain('<div id="root"></div>');

  const unknownApi = await fetch(`${base}/api/unknown`);
  expect(unknownApi.status).toBe(404);
  expect(unknownApi.headers.get("content-type")).not.toContain("text/html");
});

test("--migrate requires a database URL and does not start the server", async () => {
  const result = Bun.spawnSync([cleanBinary, "--migrate"], {
    cwd: cleanDir,
    env: { PATH: "/usr/bin:/bin" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("DATABASE_URL is required for --migrate");
});

// Each run gets a scratch database, so migrations from other suites on the same server cannot interfere.
test.skipIf(!databaseUrl)("--migrate applies pending migrations once and then reports none", async () => {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for this test");
  const name = `moneytrap_binary_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: databaseUrl });
  await admin.query(`create database ${name}`);
  const scratch = new URL(databaseUrl);
  scratch.pathname = `/${name}`;
  const scratchUrl = scratch.toString();

  try {
    const run = () =>
      Bun.spawnSync([cleanBinary, "--migrate"], {
        cwd: cleanDir,
        env: { DATABASE_URL: scratchUrl, PATH: "/usr/bin:/bin" },
      });

    const first = run();
    expect(first.exitCode, first.stderr.toString()).toBe(0);
    const second = run();
    expect(second.exitCode, second.stderr.toString()).toBe(0);
    expect(second.stdout.toString()).toContain("No pending migrations.");

    const pool = new Pool({ connectionString: scratchUrl });
    try {
      const applied = await pool.query("select name from kysely_migration order by name");
      expect(applied.rows.map((row) => row.name)).toContain("0001_platform");
    } finally {
      await pool.end();
    }
  } finally {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  }
});
