import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Pool } from "pg";

const binary = resolve(import.meta.dir, "../../dist/moneytrap-spike");
const port = 18_000 + Math.floor(Math.random() * 20_000);
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let cleanDir = "";
let cleanBinary = binary;

beforeAll(async () => {
  const build = Bun.spawnSync([process.execPath, "run", resolve(import.meta.dir, "build.ts")]);
  expect(build.exitCode, build.stderr.toString()).toBe(0);
  cleanDir = await mkdtemp(resolve(tmpdir(), "moneytrap-spike-"));
  cleanBinary = resolve(cleanDir, "moneytrap-spike");
  await copyFile(binary, cleanBinary);
});

afterAll(async () => {
  serverProcess?.kill();
  if (cleanDir) await rm(cleanDir, { recursive: true, force: true });
});

test("compiled binary serves its route and embedded page", async () => {
  expect(existsSync(binary)).toBe(true);
  serverProcess = Bun.spawn([cleanBinary], {
    cwd: cleanDir,
    env: { PORT: String(port), PATH: "/usr/bin:/bin" },
    stdout: "pipe",
    stderr: "pipe",
  });

  let health: Response | undefined;
  for (let attempt = 0; attempt < 250; attempt++) {
    try {
      health = await fetch(`http://127.0.0.1:${port}/health`);
      break;
    } catch {
      await Bun.sleep(20);
    }
  }

  expect(health?.status).toBe(200);
  expect(await health?.text()).toBe("ok");
  const page = await fetch(`http://127.0.0.1:${port}/`);
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toContain("text/html");
  expect(await page.text()).toContain('<main id="app"></main>');
  const script = await fetch(`http://127.0.0.1:${port}/app.js`);
  expect(script.status).toBe(200);
  expect(script.headers.get("content-type")).toContain("text/javascript");
  expect(await script.text()).toContain("Moneytrap binary spike");
});

test("--migrate requires a database URL", async () => {
  const result = Bun.spawnSync([cleanBinary, "--migrate"], {
    cwd: cleanDir,
    env: { PATH: "/usr/bin:/bin" },
  });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("DATABASE_URL is required for --migrate");
});

test.skipIf(!Bun.env.BINARY_SPIKE_DATABASE_URL)("compiled binary migrates PostgreSQL", async () => {
  const connectionString = Bun.env.BINARY_SPIKE_DATABASE_URL;
  if (!connectionString) throw new Error("BINARY_SPIKE_DATABASE_URL is required for this test");
  const result = Bun.spawnSync([cleanBinary, "--migrate"], {
    cwd: cleanDir,
    env: { DATABASE_URL: connectionString, PATH: "/usr/bin:/bin" },
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  const pool = new Pool({ connectionString });
  try {
    const table = await pool.query("select to_regclass('binary_spike_probe') as table_name");
    expect(table.rows[0]?.table_name).toBe("binary_spike_probe");
  } finally {
    await pool.end();
  }
});
