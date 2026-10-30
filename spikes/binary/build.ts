import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const outdir = resolve(import.meta.dir, "../../dist");
await mkdir(outdir, { recursive: true });
const assetsDir = resolve(import.meta.dir, "../../node_modules/.cache/moneytrap-binary");
await mkdir(assetsDir, { recursive: true });

const page = await Bun.build({
  entrypoints: [resolve(import.meta.dir, "page.tsx")],
  outdir: assetsDir,
  target: "browser",
  naming: "binary-page.js",
  minify: true,
});
if (!page.success) throw new AggregateError(page.logs, "React page build failed");

const server = Bun.spawnSync([
  process.execPath,
  "build",
  "--compile",
  resolve(import.meta.dir, "server.ts"),
  "--outfile",
  resolve(outdir, "moneytrap-spike"),
]);
if (server.exitCode !== 0) {
  throw new Error(`Binary build failed:\n${server.stderr.toString()}`);
}
