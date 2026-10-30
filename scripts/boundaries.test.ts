import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const violation = join(root, "packages/domain/src", `__boundary_violation_${randomUUID()}.ts`);

function boundaries() {
  const result = spawnSync("bun", ["run", "boundaries"], { cwd: root, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

test("clean workspace passes boundary checks", () => {
  const result = boundaries();
  expect(result.status, result.output).toBe(0);
});

test("domain cannot import the Postgres adapter", () => {
  writeFileSync(violation, 'import "../../adapter-postgres/src/index.ts";\n');
  try {
    const result = boundaries();
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("domain-no-workspace-imports");
  } finally {
    unlinkSync(violation);
  }
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
