import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
function boundaries() {
  const result = spawnSync("bun", ["run", "boundaries"], { cwd: root, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

function expectViolation(packageName: string, moduleName: string, ruleName: string) {
  const violation = join(root, `packages/${packageName}/src`, `__boundary_violation_${randomUUID()}.ts`);
  writeFileSync(violation, `import "${moduleName}";\n`);
  try {
    const result = boundaries();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(ruleName);
  } finally {
    unlinkSync(violation);
  }
}

test("clean workspace passes boundary checks", () => {
  const result = boundaries();
  expect(result.status, result.output).toBe(0);
});

test("domain cannot import the Postgres adapter", () => {
  expectViolation("domain", "../../adapter-postgres/src/index.ts", "domain-no-workspace-imports");
});

test("domain cannot import Node I/O", () => {
  expectViolation("domain", "node:fs", "domain-no-core-imports");
});

test("domain cannot import Elysia", () => {
  expectViolation("domain", "elysia", "domain-no-framework-imports");
});

test("app cannot import the Redis client", () => {
  expectViolation("app", "@redis/client", "app-no-redis-or-elysia");
});

function probeFile(relDir: string, source: string) {
  const dir = join(root, relDir);
  const file = join(dir, `__boundary_probe_${randomUUID()}.ts`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, source);
  return file;
}

test("contracts cannot import an adapter (only apps/server wires adapters)", () => {
  const file = probeFile("packages/contracts/src", 'import "../../adapter-postgres/src/index.ts";\n');
  try {
    const result = boundaries();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("adapters-only-from-server");
  } finally {
    unlinkSync(file);
  }
});

test("apps/web may import packages/ui", () => {
  const uiDir = join(root, "packages/ui/src");
  const uiIndex = join(uiDir, "index.ts");
  const file = probeFile("apps/web/src", 'import "../../../packages/ui/src/index.ts";\n');
  try {
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(uiIndex, "export {};\n");
    const result = boundaries();
    expect(result.status, result.output).toBe(0);
  } finally {
    unlinkSync(file);
    rmSync(join(root, "packages/ui"), { recursive: true, force: true });
  }
});
