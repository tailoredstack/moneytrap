// CI change detection. Decides which areas a pull request touches, so the workflow skips jobs the change cannot reach.
//
// Skipping must be proven, so every doubt runs everything. The decision is "full" (all areas true) when the event is
// not a pull request, BASE_SHA is missing, the change list cannot be read or is empty, a shared file changed (the
// workflow, lockfile, any package.json, tsconfig, biome, dependency-cruiser, mise, scripts/, ops/), or a path belongs
// to no known area.
//
// Outputs (also written to $GITHUB_OUTPUT): full, docs, docs_only, code, db, binary, reason.
// - docs: a documentation file changed (docs/ or *.md).
// - docs_only: every changed file is documentation. The docs checks still run, nothing else needs to.
// - code: a source file under apps/, packages/, or spikes/ changed. Gates typecheck, lint, boundaries, and tests.
// - db: a file the PostgreSQL job can reach changed, or the conformance catalog changed (check:drift runs the touched
//   cases there, with a database).
// - binary: a file build:binary bundles changed.
// Replay locally: GITHUB_EVENT_NAME=pull_request BASE_SHA=<sha> bun scripts/ci-changes.ts
import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { CONFORMANCE_CATALOG } from "./check-drift";

export interface Decision {
  full: boolean;
  docs: boolean;
  docsOnly: boolean;
  code: boolean;
  db: boolean;
  binary: boolean;
  reason: string;
}

export interface DecisionInput {
  event: string | undefined;
  baseSha: string | undefined;
  // The changed paths, or null when they could not be read.
  changed: string[] | null;
}

// Shared files: a change here can alter what every job does. They win over the documentation rule, so scripts/NOTES.md
// still runs everything.
export const SHARED = [
  /^\.github\//,
  /(?:^|\/)package\.json$/,
  /(?:^|\/)bun\.lockb?$/,
  /(?:^|\/)tsconfig[^/]*\.json$/,
  /(?:^|\/)biome\.jsonc?$/,
  /^\.dependency-cruiser\.[^/]+$/,
  /(?:^|\/)\.?mise\.toml$/,
  /^\.tool-versions$/,
  /^scripts\//,
  /^ops\//,
];

// Biome and the type checker read these, so a file with one of them under docs/ is code, not documentation.
const CODE_EXTENSION = /\.(?:cjs|mjs|js|jsx|json|jsonc|ts|tsx)$/;

export const isDoc = (path: string) => path.endsWith(".md") || (path.startsWith("docs/") && !CODE_EXTENSION.test(path));
export const isShared = (path: string) => SHARED.some((re) => re.test(path));
export const isCodeArea = (path: string) => /^(?:apps|packages|spikes)\//.test(path);

// What the PostgreSQL job can reach: the adapter and the auth tests in apps/server, plus every workspace package they
// depend on, and the conformance cases check:drift runs there. ci-changes.test.ts checks this against the package.json
// dependencies, so a new dependency cannot slip out of the list.
export const DB_PATHS = [
  /^apps\/server\//,
  /^packages\/(?:adapter-postgres|adapter-redis|app|conformance|contracts|domain|schema|test-kit)\//,
  /(?:^|\/)migrations\//,
];

// What build:binary bundles: the server and its workspace dependencies, and the web app with the packages it uses.
export const BINARY_PATHS = [
  /^apps\/(?:server|web)\//,
  /^packages\/(?:adapter-postgres|adapter-redis|app|contracts|domain|schema|test-kit|ui)\//,
];

const matches = (patterns: RegExp[], path: string) => patterns.some((re) => re.test(path));

const everything = (reason: string): Decision => ({
  full: true,
  docs: true,
  docsOnly: false,
  code: true,
  db: true,
  binary: true,
  reason,
});

export function decide({ event, baseSha, changed }: DecisionInput): Decision {
  if (event !== "pull_request") return everything(`event is ${JSON.stringify(event ?? "")}, not a pull request`);
  if (!baseSha) return everything("BASE_SHA is missing");
  if (changed === null) return everything("the change list could not be read");
  if (changed.length === 0) return everything("the change list is empty");

  const decision: Decision = {
    full: false,
    docs: false,
    docsOnly: true,
    code: false,
    db: false,
    binary: false,
    reason: "",
  };
  for (const path of changed) {
    if (isShared(path)) return everything(`shared file changed: ${JSON.stringify(path)}`);
    if (isDoc(path)) {
      decision.docs = true;
      // Only the conformance catalog is a doc that a database job reads: check:drift runs the cases it touches.
      if (path === CONFORMANCE_CATALOG) decision.db = true;
    } else if (isCodeArea(path)) {
      decision.docsOnly = false;
      decision.code = true;
      if (matches(DB_PATHS, path)) decision.db = true;
      if (matches(BINARY_PATHS, path)) decision.binary = true;
    } else {
      return everything(`path belongs to no known area: ${JSON.stringify(path)}`);
    }
  }
  const areas = [
    decision.docs && "docs",
    decision.code && "code",
    decision.db && "db",
    decision.binary && "binary",
  ].filter(Boolean);
  decision.reason = `${changed.length} changed file(s): ${areas.join(", ") || "none"}`;
  return decision;
}

// The paths changed between the PR base and HEAD, or null when git cannot say. --no-renames lists both sides of a
// rename, so a file moved out of a code area still counts as a change there.
export function readChanged(baseSha: string, cwd = process.cwd()): string[] | null {
  const result = spawnSync("git", ["diff", "--name-only", "-z", "--no-renames", `${baseSha}...HEAD`], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split("\0").filter(Boolean);
}

// One line per output. The reason quotes every path (JSON.stringify), so a newline in a file name adds no output.
export function formatOutputs(d: Decision): string {
  return [
    `full=${d.full}`,
    `docs=${d.docs}`,
    `docs_only=${d.docsOnly}`,
    `code=${d.code}`,
    `db=${d.db}`,
    `binary=${d.binary}`,
    `reason=${d.reason}`,
  ].join("\n");
}

if (import.meta.main) {
  const event = process.env.GITHUB_EVENT_NAME;
  const baseSha = process.env.BASE_SHA || undefined;
  const changed = event === "pull_request" && baseSha ? readChanged(baseSha) : null;
  const decision = decide({ event, baseSha, changed });
  const outputs = formatOutputs(decision);
  console.log(outputs);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${outputs}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = Object.entries({ ...decision }).map(([key, value]) => `| ${key} | ${value} |`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `| Output | Value |\n| --- | --- |\n${rows.join("\n")}\n`);
  }
}
