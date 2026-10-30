import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
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

test("domain cannot import the Postgres client", () => {
  expectViolation("domain", "pg", "domain-no-database-imports");
});

test("app cannot import the Redis client", () => {
  expectViolation("app", "@redis/client", "app-no-redis-or-elysia");
});

test("app cannot import Elysia plugins", () => {
  expectViolation("app", "@elysiajs/cors", "app-no-redis-or-elysia");
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
  const uiRoot = join(root, "packages/ui");
  const uiDir = join(root, "packages/ui/src");
  const uiIndex = join(uiDir, "index.ts");
  const hadUiRoot = existsSync(uiRoot);
  const hadUiDir = existsSync(uiDir);
  const hadUiIndex = existsSync(uiIndex);
  const file = probeFile("apps/web/src", 'import "../../../packages/ui/src/index.ts";\n');
  try {
    mkdirSync(uiDir, { recursive: true });
    if (!hadUiIndex) writeFileSync(uiIndex, "export {};\n");
    const result = boundaries();
    expect(result.status, result.output).toBe(0);
  } finally {
    unlinkSync(file);
    if (!hadUiIndex) unlinkSync(uiIndex);
    if (!hadUiDir) rmdirSync(uiDir);
    if (!hadUiRoot) rmdirSync(uiRoot);
  }
});

test("scripts cannot import an adapter", () => {
  const probe = join(root, "scripts", `__boundary_violation_${randomUUID()}.ts`);
  writeFileSync(probe, 'import "../packages/adapter-postgres/src/index.ts";\n');
  try {
    const result = boundaries();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("adapters-only-from-server");
  } finally {
    unlinkSync(probe);
  }
});

test("packages/ui cannot import domain (ui-only-contracts)", () => {
  const uiRoot = join(root, "packages/ui");
  const uiDir = join(root, "packages/ui/src");
  const hadUiRoot = existsSync(uiRoot);
  const hadUiDir = existsSync(uiDir);
  const probe = join(uiDir, `__boundary_violation_${randomUUID()}.ts`);
  mkdirSync(uiDir, { recursive: true });
  writeFileSync(probe, 'import "../../domain/src/index.ts";\n');
  try {
    const result = boundaries();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("ui-only-contracts");
  } finally {
    unlinkSync(probe);
    if (!hadUiDir) rmdirSync(uiDir);
    if (!hadUiRoot) rmdirSync(uiRoot);
  }
});

function expectProbeViolation(relDir: string, source: string, ruleName: string) {
  const file = join(root, relDir, `__boundary_violation_${randomUUID()}.ts`);
  writeFileSync(file, source);
  try {
    const result = boundaries();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain(ruleName);
  } finally {
    unlinkSync(file);
  }
}

test("web cannot import the app package (web-only-contracts-and-ui)", () => {
  expectProbeViolation("apps/web/src", 'import "../../../packages/app/src/index.ts";\n', "web-only-contracts-and-ui");
});

test("app cannot import contracts (app-only-domain-and-schema)", () => {
  expectProbeViolation("packages/app/src", 'import "../../contracts/src/index.ts";\n', "app-only-domain-and-schema");
});

test("app may import schema only as types (app-schema-types-only)", () => {
  expectProbeViolation("packages/app/src", 'import "../../schema/src/index.ts";\n', "app-schema-types-only");
});

test("adapters cannot import each other (adapters-no-cross-imports)", () => {
  expectProbeViolation(
    "packages/adapter-redis/src",
    'import "../../adapter-postgres/src/index.ts";\n',
    "adapters-no-cross-imports",
  );
});
