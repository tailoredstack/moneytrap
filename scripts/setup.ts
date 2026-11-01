// One-time local setup for Moneytrap. Safe to run more than once: every step prints "skipped" when it is already done.
// Run from the repo root: bun run setup
//
// Steps: .env files, the server's BETTER_AUTH_SECRET, the local Postgres, Redis, and Mailpit stack, dependencies,
// migrations, and the dev seed. Imports only Node built-ins and ./setup-env, so it runs before `bun install`.

import { dirname, join, resolve } from "node:path";
import { ensureEnvFile, ensureSecret } from "./setup-env";

const root = resolve(import.meta.dir, "..");
const COMPOSE_FILE = "ops/docker-compose.yml";
const STACK_SERVICES = ["postgres", "redis", "mailpit"];

type Output = { code: number; stdout: string; stderr: string };

function report(step: string, result: string): void {
  console.log(`[setup] ${step}: ${result}`);
}

// Runs a command from the repo root. Output is captured, unless `inherit` shows it live (for a slow first start).
async function run(cmd: string[], { inherit = false } = {}): Promise<Output> {
  try {
    const proc = Bun.spawn(cmd, {
      cwd: root,
      stdout: inherit ? "inherit" : "pipe",
      stderr: inherit ? "inherit" : "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      inherit ? "" : new Response(proc.stdout).text(),
      inherit ? "" : new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { code, stdout, stderr };
  } catch (error) {
    return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

async function mustRun(cmd: string[], options?: { inherit?: boolean }): Promise<Output> {
  const result = await run(cmd, options);
  if (result.code !== 0) {
    throw new Error(`\`${cmd.join(" ")}\` exited ${result.code}\n${result.stdout}${result.stderr}`);
  }
  return result;
}

async function setupEnvFiles(): Promise<void> {
  const examples = [
    ".env.example",
    ...new Bun.Glob("{apps,packages,spikes}/*/.env.example").scanSync({ cwd: root, dot: true }),
  ].sort();
  for (const example of examples) {
    const dir = dirname(example);
    const label = dir === "." ? "root" : dir;
    const result = ensureEnvFile(join(root, dir));
    report(`${label} .env`, result === "created" ? "created from .env.example" : "skipped (already exists)");
  }
}

async function setupSecret(): Promise<void> {
  const result = ensureSecret(join(root, "apps/server"));
  report("apps/server BETTER_AUTH_SECRET", result === "generated" ? "generated" : "skipped (already set)");
}

// The stack is healthy when every service it needs is running and reports healthy. Otherwise `up --wait` starts it.
async function stackHealthy(): Promise<boolean> {
  const ps = await run(["docker", "compose", "-f", COMPOSE_FILE, "ps", "--format", "json"]);
  if (ps.code !== 0) return false;
  const text = ps.stdout.trim();
  if (text === "") return false;
  const services: Array<{ Service: string; State: string; Health: string }> = text.startsWith("[")
    ? JSON.parse(text)
    : text.split("\n").map((line) => JSON.parse(line));
  return STACK_SERVICES.every((name) =>
    services.some((service) => service.Service === name && service.State === "running" && service.Health === "healthy"),
  );
}

async function setupStack(): Promise<void> {
  if (await stackHealthy()) {
    report("local stack", `skipped (${STACK_SERVICES.join(" and ")} already running and healthy)`);
    return;
  }
  await mustRun(["docker", "compose", "-f", COMPOSE_FILE, "up", "-d", "--wait"], { inherit: true });
  report("local stack", `started (${STACK_SERVICES.join(", ")})`);
}

async function setupDependencies(): Promise<void> {
  const install = await mustRun(["bun", "install"]);
  const unchanged = /\(no changes\)/.test(install.stdout + install.stderr);
  report("dependencies", unchanged ? "skipped (already installed)" : "installed");
}

async function setupMigrations(): Promise<void> {
  const migrate = await mustRun(["bun", "run", "db:migrate"]);
  const applied = migrate.stdout.split("\n").filter((line) => line.startsWith("applied "));
  report("database migrations", applied.length === 0 ? "skipped (no pending migrations)" : `applied ${applied.length}`);
}

async function setupSeed(): Promise<void> {
  const seed = await mustRun(["bun", "run", "seed"]);
  const rows = seed.stdout.split("\n").filter((line) => /^(inserted|skipped) /.test(line));
  const inserted = rows.filter((line) => line.startsWith("inserted ")).length;
  report("dev seed", inserted === 0 ? `skipped (${rows.length} rows already present)` : `inserted ${inserted} rows`);
}

try {
  await setupEnvFiles();
  await setupSecret();
  await setupStack();
  await setupDependencies();
  await setupMigrations();
  await setupSeed();
  console.log(
    "[setup] done. Sign in at /login with owner@moneytrap.test / dev-only-moneytrap-password (local use only).",
  );
} catch (error) {
  console.error(`[setup] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
