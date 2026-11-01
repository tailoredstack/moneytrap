// Creates `.env` from `.env.example` in one directory, and can replace the placeholder Better Auth secret.
// Never overwrites an existing `.env`. Safe to run more than once.
//
// Run from a package directory: bun ../../scripts/setup-env.ts [--secret]
// `--secret` also replaces a placeholder BETTER_AUTH_SECRET in that directory's `.env`.

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type EnvResult = "created" | "exists";

// Copies `.env.example` to `.env` when `.env` is missing. Returns what happened, so callers can report a skip.
export function ensureEnvFile(dir: string): EnvResult {
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) return "exists";
  copyFileSync(join(dir, ".env.example"), envPath);
  return "created";
}

// The placeholder is whatever `.env.example` ships with, so the check follows the example file. A secret that differs
// from it, or that is already set, is kept.
export function ensureSecret(dir: string): "generated" | "exists" {
  const envPath = join(dir, ".env");
  const key = "BETTER_AUTH_SECRET";
  const placeholder = readEnvValue(join(dir, ".env.example"), key);
  const current = readEnvValue(envPath, key);
  if (current !== undefined && current !== "" && current !== placeholder) return "exists";

  const secret = randomBytes(32).toString("base64");
  const lines = readFileSync(envPath, "utf8").split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (index === -1) lines.push(`${key}=${secret}`);
  else lines[index] = `${key}=${secret}`;
  writeFileSync(envPath, lines.join("\n"));
  return "generated";
}

function readEnvValue(path: string, key: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const line = readFileSync(path, "utf8")
    .split("\n")
    .find((candidate) => candidate.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

if (import.meta.main) {
  const dir = process.cwd();
  const env = ensureEnvFile(dir);
  console.log(
    `[setup] .env in ${dir}: ${env === "created" ? "created from .env.example" : "skipped (already exists)"}`,
  );
  if (process.argv.includes("--secret")) {
    const secret = ensureSecret(dir);
    console.log(`[setup] BETTER_AUTH_SECRET: ${secret === "generated" ? "generated" : "skipped (already set)"}`);
  }
}
