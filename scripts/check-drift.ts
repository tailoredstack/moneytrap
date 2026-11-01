// WP-X.4 spec drift check. Compares the changed files on a branch against the spec and contract versions.
//
// - A change under docs/legacy/ is a spec change. It needs a higher "**Version:**" line in the technical specification.
// - A change to packages/contracts/src (other than tests) is a contract change. It needs a higher "version" in
//   packages/contracts/package.json.
// - The conformance cases touched by the branch (CT rows changed in the conformance catalog, or conformance tests
//   changed) are run and must be green.
//
// The base is $BASE_SHA when CI sets it, else origin/main. The diff runs from the merge base to the working tree, so
// it sees the same files in CI (clean tree) and before a commit, including untracked files. Usage: bun scripts/check-drift.ts [--skip-conformance]
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const SPEC_DIR = "docs/legacy/";
export const SPEC_VERSION_FILE = "docs/legacy/MONEYTRAP_TECHNICAL_SPECIFICATION_COMPLETE.md";
export const CONFORMANCE_CATALOG = "docs/legacy/MONEYTRAP_CONFORMANCE_CASES.md";
export const CONTRACT_SRC_DIR = "packages/contracts/src/";
export const CONTRACT_VERSION_FILE = "packages/contracts/package.json";
export const CONFORMANCE_TEST_DIR = "packages/conformance/src/ct/";

export const isSpecFile = (path: string) => path.startsWith(SPEC_DIR);
export const isContractFile = (path: string) => path.startsWith(CONTRACT_SRC_DIR) && !path.endsWith(".test.ts");
export const isConformanceTest = (path: string) => path.startsWith(CONFORMANCE_TEST_DIR) && path.endsWith(".test.ts");

// The first "**Version:** 2.0 (note)" line. Returns the version token, or null when the line is absent.
export function parseSpecVersion(markdown: string): string | null {
  return /^\*\*Version:\*\*[ \t]*(\S+)/m.exec(markdown)?.[1] ?? null;
}

export function parseContractVersion(packageJson: string): string | null {
  try {
    const version = (JSON.parse(packageJson) as { version?: unknown }).version;
    return typeof version === "string" && version !== "" ? version : null;
  } catch {
    return null;
  }
}

// Compares dot-separated numeric versions. Returns a negative, zero, or positive number, or null when either side is
// not made only of numeric parts (for example "2.0-rc1"), so the caller can say the version cannot be compared.
export function compareVersions(a: string, b: string): number | null {
  const parts = (v: string) => (/^\d+(?:\.\d+)*$/.test(v) ? v.split(".").map(Number) : null);
  const left = parts(a);
  const right = parts(b);
  if (!left || !right) return null;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export interface VersionPair {
  base: string | null;
  head: string | null;
}

// One drift rule: when the guarded files changed, the version must have moved up.
function checkBump(label: string, files: string[], versionFile: string, versions: VersionPair): string[] {
  if (files.length === 0) return [];
  const shown = files.slice(0, 5).join(", ") + (files.length > 5 ? `, and ${files.length - 5} more` : "");
  if (versions.head === null) {
    return [`${label} changed (${shown}) but ${versionFile} has no readable version`];
  }
  // A version file that is new on the branch has no base, so any head version stands. A base file with no version
  // line is read as "0" by the caller, so adding a version above 0 counts as a bump.
  if (versions.base === null) return [];
  const order = compareVersions(versions.head, versions.base);
  if (order === null) {
    return [`${label} changed but versions "${versions.base}" -> "${versions.head}" in ${versionFile} are not numeric`];
  }
  if (order <= 0) {
    return [`${label} changed (${shown}) without a version bump: ${versionFile} is still ${versions.head}`];
  }
  return [];
}

export interface DriftInput {
  changed: string[];
  spec: VersionPair;
  contract: VersionPair;
}

export function checkVersionDrift({ changed, spec, contract }: DriftInput): string[] {
  return [
    ...checkBump("spec", changed.filter(isSpecFile), SPEC_VERSION_FILE, spec),
    ...checkBump("contract", changed.filter(isContractFile), CONTRACT_VERSION_FILE, contract),
  ];
}

// CT IDs on added or removed table rows of a unified diff of the conformance catalog.
export function changedCaseIds(catalogDiff: string): string[] {
  const ids = new Set<string>();
  for (const line of catalogDiff.split("\n")) {
    if (!/^[+-](?![+-])/.test(line)) continue;
    const id = /^[+-]\| (CT-\d{3}) \|/.exec(line)?.[1];
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

export interface ConformanceSelection {
  tests: string[];
  uncovered: string[];
}

// The conformance test files to run: every changed conformance test, plus each test that names a touched CT ID.
// A touched ID with no test yet is reported, not failed, because cases land in the wave that implements them.
export function selectConformance(
  changed: string[],
  caseIds: string[],
  testSources: ReadonlyMap<string, string>,
): ConformanceSelection {
  const tests = new Set(changed.filter((p) => isConformanceTest(p) && testSources.has(p)));
  const uncovered: string[] = [];
  for (const id of caseIds) {
    const re = new RegExp(`(?<![\\w-])${id}(?!\\d)`);
    const hits = [...testSources].filter(([, source]) => re.test(source)).map(([path]) => path);
    if (hits.length === 0) uncovered.push(id);
    for (const path of hits) tests.add(path);
  }
  return { tests: [...tests].sort(), uncovered };
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, out: result.stdout };
}

export interface DriftReport {
  errors: string[];
  tests: string[];
  uncovered: string[];
  base: string;
  changed: string[];
}

export function collectDrift(root: string, baseRef: string): DriftReport {
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]);
  if (!mergeBase.ok || mergeBase.out.trim() === "") {
    throw new Error(`cannot find a merge base with ${baseRef}; fetch it (fetch-depth 0) or set BASE_SHA`);
  }
  const base = mergeBase.out.trim();
  // -z keeps non-ASCII paths unquoted. Untracked files count too, so a new spec file is seen before it is added.
  const diff = git(root, ["diff", "--name-only", "-z", "--no-renames", base]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!diff.ok || !untracked.ok) throw new Error(`git diff against ${base} failed`);
  const changed = [...new Set([...diff.out.split("\0"), ...untracked.out.split("\0")].filter(Boolean))];

  const atBase = (path: string) => {
    const shown = git(root, ["show", `${base}:${path}`]);
    return shown.ok ? shown.out : null;
  };
  const atHead = (path: string) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null);
  const specBase = atBase(SPEC_VERSION_FILE);
  const specHead = atHead(SPEC_VERSION_FILE);
  const contractBase = atBase(CONTRACT_VERSION_FILE);
  const contractHead = atHead(CONTRACT_VERSION_FILE);
  const errors = checkVersionDrift({
    changed,
    spec: {
      base: specBase === null ? null : (parseSpecVersion(specBase) ?? "0"),
      head: specHead === null ? null : parseSpecVersion(specHead),
    },
    contract: {
      base: contractBase === null ? null : (parseContractVersion(contractBase) ?? "0"),
      head: contractHead === null ? null : parseContractVersion(contractHead),
    },
  });

  // An untracked catalog has no diff, so every row of it counts as added.
  const catalogDiff = !changed.includes(CONFORMANCE_CATALOG)
    ? ""
    : untracked.out.split("\0").includes(CONFORMANCE_CATALOG)
      ? (atHead(CONFORMANCE_CATALOG) ?? "").replace(/^/gm, "+")
      : git(root, ["diff", "--no-renames", "-U0", base, "--", CONFORMANCE_CATALOG]).out;
  const testDir = join(root, CONFORMANCE_TEST_DIR);
  const sources = new Map<string, string>();
  if (existsSync(testDir)) {
    for (const name of readdirSync(testDir).filter((n) => n.endsWith(".test.ts"))) {
      sources.set(CONFORMANCE_TEST_DIR + name, readFileSync(join(testDir, name), "utf8"));
    }
  }
  const { tests, uncovered } = selectConformance(changed, changedCaseIds(catalogDiff), sources);
  return { errors, tests, uncovered, base, changed };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  const baseRef = process.env.BASE_SHA || "origin/main";
  let report: DriftReport;
  try {
    report = collectDrift(root, baseRef);
  } catch (error) {
    console.error(`check-drift: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const errors = [...report.errors];

  if (report.tests.length > 0 && !process.argv.includes("--skip-conformance")) {
    console.log(`check-drift: running ${report.tests.length} conformance file(s): ${report.tests.join(", ")}`);
    const run = spawnSync("bun", ["test", ...report.tests.map((t) => `./${t}`)], { cwd: root, stdio: "inherit" });
    if (run.status !== 0) errors.push("touched conformance cases are not green");
  }
  for (const id of report.uncovered)
    console.log(`check-drift: note: ${id} changed but no conformance test names it yet`);

  if (errors.length > 0) {
    console.error(`check-drift: ${errors.length} problem(s)\n`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`check-drift: ok (${report.changed.length} changed files against ${report.base.slice(0, 9)})`);
}
