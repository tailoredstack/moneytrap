import { readdirSync } from "node:fs";
import { join } from "node:path";

const portsDir = join(import.meta.dir, "../../app/src/ports");
const fakesDir = join(import.meta.dir, "fakes");

/** Enforces one fake module per application port, including ports added later. */
export function missingPortFakes(): string[] {
  const fakeFiles = new Set(readdirSync(fakesDir));
  return readdirSync(portsDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .filter((name) => !fakeFiles.has(name));
}

if (import.meta.main) {
  const missing = missingPortFakes();
  if (missing.length > 0) {
    console.error(`Missing test-kit fakes for app ports: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}
