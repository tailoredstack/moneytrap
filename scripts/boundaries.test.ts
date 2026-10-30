import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
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
