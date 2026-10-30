import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outdir = resolve(import.meta.dir, "dist");
await mkdir(outdir, { recursive: true });

const server = Bun.spawnSync([
  process.execPath,
  "build",
  "--compile",
  resolve(import.meta.dir, "src/server.ts"),
  "--outfile",
  resolve(outdir, "moneytrap-compat"),
]);
if (server.exitCode !== 0) {
  throw new Error(`Binary build failed:\n${server.stderr.toString()}`);
}
