import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Time and ID generation come from the Clock and IdGenerator ports, so domain and app code never read them directly.
const roots = [join(import.meta.dir, ".."), join(import.meta.dir, "../../../domain/src")];
const forbidden = /Date\.now\(|new Date\(\)|Math\.random\(|crypto\.randomUUID\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith(".ts") && !path.endsWith(".test.ts") ? [path] : [];
  });
}

test("TP-W1-008 domain and app code read no ambient time or randomness", () => {
  const offenders = roots.flatMap((root) => sources(root).filter((file) => forbidden.test(readFileSync(file, "utf8"))));
  expect(offenders).toEqual([]);
});
