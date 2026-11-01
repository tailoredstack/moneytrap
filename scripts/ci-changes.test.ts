import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse } from "yaml";
import { CONFORMANCE_CATALOG } from "./check-drift";
import { BINARY_PATHS, DB_PATHS, type Decision, decide, formatOutputs, readChanged } from "./ci-changes";

const root = resolve(import.meta.dir, "..");
const pr = (changed: string[] | null, baseSha: string | undefined = "abc123") =>
  decide({ event: "pull_request", baseSha, changed });

const everything = (d: Decision) => [d.full, d.docs, d.code, d.db, d.binary];

test("a docs-only change keeps every code job off", () => {
  const d = pr(["docs/adr/ADR-003-postgres-kysely-migrations.md", "README.md", "packages/app/README.md"]);
  expect(d).toMatchObject({ full: false, docs: true, docsOnly: true, code: false, db: false, binary: false });
});

test("a change under docs/ that is not a document is not docs-only", () => {
  expect(pr(["docs/schema.json"]).full).toBe(true);
  expect(pr(["docs/legacy/model.ts"]).full).toBe(true);
  expect(pr(["docs/ui/wireframe.png"]).docsOnly).toBe(true);
});

test("only the conformance catalog sends a docs change to the database job", () => {
  expect(pr(["docs/legacy/MONEYTRAP_API_OPERATIONS.md"]).db).toBe(false);
  expect(pr([CONFORMANCE_CATALOG])).toMatchObject({ docsOnly: true, db: true, code: false });
});

test("an adapter-postgres change reaches the database job and the binary but no more than needed", () => {
  const d = pr(["packages/adapter-postgres/src/links/bulk-jobs.ts"]);
  expect(d).toMatchObject({ full: false, docsOnly: false, code: true, db: true, binary: true });
});

test("a web-only change skips the database job", () => {
  expect(pr(["apps/web/src/routes/links.tsx"])).toMatchObject({ code: true, db: false, binary: true });
  expect(pr(["packages/ui/src/button.tsx"])).toMatchObject({ code: true, db: false, binary: true });
});

test("a package outside the server and web bundle skips the binary build and the database job", () => {
  expect(pr(["packages/adapter-notify/src/index.ts"])).toMatchObject({ code: true, db: false, binary: false });
  expect(pr(["spikes/redirect/src/run.ts"])).toMatchObject({ code: true, db: false, binary: false });
});

test("conformance and migrations reach the database job", () => {
  expect(pr(["packages/conformance/src/ct/ct-001.test.ts"])).toMatchObject({ db: true, binary: false });
  expect(pr(["packages/adapter-postgres/src/migrations/0004_x.ts"]).db).toBe(true);
  expect(pr(["apps/server/src/auth/session.ts"])).toMatchObject({ db: true, binary: true });
});

test("a mixed change takes the union of its areas", () => {
  const d = pr(["docs/README.md", "apps/web/src/main.tsx"]);
  expect(d).toMatchObject({ docs: true, docsOnly: false, code: true, db: false, binary: true });
});

test.each([
  ".github/workflows/ci.yml",
  ".github/pull_request_template.md",
  "bun.lock",
  "package.json",
  "packages/app/package.json",
  "tsconfig.base.json",
  "apps/web/tsconfig.json",
  "biome.json",
  "biome.jsonc",
  ".dependency-cruiser.cjs",
  "mise.toml",
  ".mise.toml",
  "scripts/affected-tests.sh",
  "scripts/ci-changes.ts",
  "scripts/notes.md",
  "ops/docker-compose.yml",
])("a shared file runs everything: %s", (path) => {
  const d = pr([path]);
  expect(d.full).toBe(true);
  expect(everything(d)).toEqual([true, true, true, true, true]);
  expect(d.docsOnly).toBe(false);
});

test("a shared file wins over a docs change in the same diff", () => {
  expect(pr(["docs/README.md", "bun.lock"]).full).toBe(true);
});

test("a path that belongs to no known area runs everything", () => {
  expect(pr([".mcp.json"]).full).toBe(true);
  expect(pr([".gitignore"]).full).toBe(true);
  expect(pr(["new-top-level/file.ts"]).full).toBe(true);
});

test("a push runs everything, even with a base and a docs-only diff", () => {
  const d = decide({ event: "push", baseSha: "abc123", changed: ["README.md"] });
  expect(d).toMatchObject({ full: true, docsOnly: false, code: true, db: true, binary: true });
  expect(decide({ event: undefined, baseSha: "abc123", changed: ["README.md"] }).full).toBe(true);
});

test("a missing base, an unreadable list, or an empty list runs everything", () => {
  const noBase = (baseSha: string | undefined) => decide({ event: "pull_request", baseSha, changed: ["README.md"] });
  expect(noBase(undefined).reason).toBe("BASE_SHA is missing");
  expect(noBase("").full).toBe(true);
  expect(pr(null).reason).toBe("the change list could not be read");
  expect(pr([]).reason).toBe("the change list is empty");
});

test("a file name cannot add an output line", () => {
  const out = formatOutputs(pr(["weird\nfull=false"])).split("\n");
  expect(out).toHaveLength(7);
  expect(out.filter((line) => line.startsWith("full="))).toEqual(["full=true"]);
});

test("the outputs are one key=value line each", () => {
  expect(formatOutputs(pr(["README.md"])).split("\n")).toEqual([
    "full=false",
    "docs=true",
    "docs_only=true",
    "code=false",
    "db=false",
    "binary=false",
    "reason=1 changed file(s): docs",
  ]);
});

// The workspace packages, by name, with the workspace packages each depends on.
function workspaces(): Map<string, { dir: string; deps: string[] }> {
  const found = new Map<string, { dir: string; deps: string[] }>();
  for (const parent of ["apps", "packages"]) {
    for (const name of readdirSync(join(root, parent))) {
      const file = join(root, parent, name, "package.json");
      let manifest: { name: string; dependencies?: object; devDependencies?: object };
      try {
        manifest = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
      found.set(manifest.name, { dir: `${parent}/${name}`, deps: deps.filter((d) => d.startsWith("@moneytrap/")) });
    }
  }
  return found;
}

function closure(start: string[], all: ReturnType<typeof workspaces>): string[] {
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    for (const dep of all.get(name)?.deps ?? []) visit(dep);
  };
  start.forEach(visit);
  return [...seen].map((name) => all.get(name)?.dir ?? name);
}

test("the database paths cover everything the PostgreSQL job's tests import", () => {
  const all = workspaces();
  // The job tests packages/adapter-postgres and apps/server/src/auth, and check:drift runs packages/conformance.
  const dirs = closure(["@moneytrap/adapter-postgres", "@moneytrap/server", "@moneytrap/conformance"], all);
  expect(dirs).toContain("packages/domain");
  for (const dir of dirs) {
    expect(
      DB_PATHS.some((re) => re.test(`${dir}/src/x.ts`)),
      `${dir} is reachable but not in DB_PATHS`,
    ).toBe(true);
  }
});

test("the binary paths cover everything the server and web bundle", () => {
  const dirs = closure(["@moneytrap/server", "@moneytrap/web"], workspaces());
  expect(dirs).toContain("packages/ui");
  for (const dir of dirs) {
    expect(
      BINARY_PATHS.some((re) => re.test(`${dir}/src/x.ts`)),
      `${dir} is bundled but not in BINARY_PATHS`,
    ).toBe(true);
  }
});

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function repoWith(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "ci-changes-"));
  git(dir, "init", "-q", "-b", "main");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  return dir;
}

function write(dir: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
}

function commit(dir: string, message: string) {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", message);
}

test("readChanged lists both sides of a rename, so a file moved out of code is still a code change", () => {
  const dir = repoWith({ "packages/adapter-postgres/src/a.ts": "export const a = 1;\n", "README.md": "# hi\n" });
  try {
    const base = git(dir, "rev-parse", "HEAD");
    mkdirSync(join(dir, "docs"));
    renameSync(join(dir, "packages/adapter-postgres/src/a.ts"), join(dir, "docs/a.md"));
    commit(dir, "move");
    const changed = readChanged(base, dir);
    expect(changed?.sort()).toEqual(["docs/a.md", "packages/adapter-postgres/src/a.ts"]);
    expect(pr(changed)).toMatchObject({ docs: true, code: true, db: true, docsOnly: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readChanged reads the PR diff from the base, not the base branch's later commits", () => {
  const dir = repoWith({ "README.md": "# hi\n" });
  try {
    const base = git(dir, "rev-parse", "HEAD");
    git(dir, "checkout", "-q", "-b", "feature");
    write(dir, { "docs/note.md": "note\n" });
    commit(dir, "feature");
    git(dir, "checkout", "-q", "main");
    write(dir, { "apps/web/src/main.tsx": "export {};\n" });
    commit(dir, "main moved on");
    git(dir, "checkout", "-q", "feature");
    expect(readChanged(base, dir)).toEqual(["docs/note.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readChanged keeps non-ASCII and spaced paths whole", () => {
  const dir = repoWith({ "README.md": "# hi\n" });
  try {
    const base = git(dir, "rev-parse", "HEAD");
    write(dir, { "docs/résumé notes.md": "x\n" });
    commit(dir, "unicode");
    expect(readChanged(base, dir)).toEqual(["docs/résumé notes.md"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readChanged returns null for an unknown base, so the caller runs everything", () => {
  const dir = repoWith({ "README.md": "# hi\n" });
  try {
    expect(readChanged("0".repeat(40), dir)).toBeNull();
    expect(readChanged("not-a-commit", dir)).toBeNull();
    expect(readChanged("abc123", join(dir, "missing-dir"))).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function cli(dir: string, env: Record<string, string>) {
  const outputFile = join(dir, "github-output");
  writeFileSync(outputFile, "");
  const result = spawnSync("bun", [join(root, "scripts/ci-changes.ts")], {
    cwd: dir,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: outputFile, ...env },
  });
  return { status: result.status, stdout: result.stdout, outputs: readFileSync(outputFile, "utf8") };
}

test("the script prints the decision and writes it to GITHUB_OUTPUT", () => {
  const dir = repoWith({ "README.md": "# hi\n", "apps/web/src/main.tsx": "export {};\n" });
  try {
    const base = git(dir, "rev-parse", "HEAD");
    write(dir, { "docs/note.md": "note\n" });
    commit(dir, "docs");
    const run = cli(dir, { GITHUB_EVENT_NAME: "pull_request", BASE_SHA: base });
    expect(run.status).toBe(0);
    expect(run.outputs).toContain("docs_only=true");
    expect(run.outputs).toContain("code=false");
    expect(run.outputs).toBe(run.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the script fails safe when git cannot read the diff or the event is a push", () => {
  const dir = repoWith({ "README.md": "# hi\n" });
  try {
    const environments: Record<string, string>[] = [
      { GITHUB_EVENT_NAME: "pull_request", BASE_SHA: "0".repeat(40) },
      { GITHUB_EVENT_NAME: "pull_request" },
      { GITHUB_EVENT_NAME: "push", BASE_SHA: git(dir, "rev-parse", "HEAD") },
      {},
    ];
    for (const env of environments) {
      const run = cli(dir, env);
      expect(run.status).toBe(0);
      expect(run.outputs).toContain("full=true");
      expect(run.outputs).toContain("db=true");
      expect(run.outputs).toContain("docs_only=false");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Job {
  name?: string;
  needs?: string;
  if?: string;
  env?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: { name?: string; if?: string; run?: string }[];
}
const workflow = parse(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8")) as { jobs: Record<string, Job> };
const OUTPUTS = new Set(
  formatOutputs(pr(["README.md"]))
    .split("\n")
    .map((line) => line.split("=")[0]),
);

test("the workflow keeps the job names that branch protection resolves", () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the workflow's own expression text
  expect(workflow.jobs.verify.name).toBe("Verify (${{ matrix.os }})");
  expect(workflow.jobs["postgres-integration"].name).toBe("PostgreSQL migrations");
  expect(Object.keys(workflow.jobs)).toEqual(["changes", "verify", "postgres-integration"]);
});

test("verify and postgres-integration need changes, and read only outputs the script writes", () => {
  const { changes, verify, "postgres-integration": postgres } = workflow.jobs;
  expect(verify.needs).toBe("changes");
  expect(postgres.needs).toBe("changes");
  expect(Object.keys(changes.outputs ?? {}).sort()).toEqual(["binary", "code", "db", "docs_only"]);
  for (const out of Object.keys(changes.outputs ?? {})) expect(OUTPUTS.has(out)).toBe(true);
  const text = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  for (const [, out] of text.matchAll(/needs\.changes\.outputs\.(\w+)/g)) expect(changes.outputs).toHaveProperty(out);
});

test("a failed changes job runs everything instead of skipping the required jobs", () => {
  const { verify, "postgres-integration": postgres } = workflow.jobs;
  // biome-ignore lint/suspicious/noTemplateCurlyInString: this is the workflow's own expression text
  expect(verify.if).toBe("${{ !cancelled() }}");
  expect(postgres.if).toContain("!cancelled()");
  expect(postgres.if).toContain("needs.changes.result != 'success'");
  for (const flag of Object.values(verify.env ?? {})) expect(flag).toContain("needs.changes.result != 'success'");
});

test("the docs checks in verify have no condition, so a docs-only change still runs them", () => {
  const steps = workflow.jobs.verify.steps;
  for (const command of ["bun run check:docs", "bun run check:drift --skip-conformance", "bun run check:ports"]) {
    const step = steps.find((s) => s.run === command);
    expect(step, command).toBeDefined();
    expect(step?.if).toBeUndefined();
  }
});

test("the gated steps are the ones the change area can skip", () => {
  const gated = workflow.jobs.verify.steps.filter((s) => s.if).map((s) => `${s.if} -> ${s.run}`);
  expect(gated).toEqual([
    "env.RUN_CODE == 'true' -> bun run typecheck",
    "env.RUN_CODE == 'true' -> bun run lint",
    "env.RUN_CODE == 'true' -> bun run boundaries",
    "env.RUN_CODE == 'true' -> bun install -g @colbymchenry/codegraph@1.6.2",
    `env.RUN_CODE == 'true' -> echo "$HOME/.bun/bin" >> "$GITHUB_PATH"`,
    "env.RUN_CODE == 'true' -> codegraph init -i",
    "env.RUN_CODE == 'true' -> bash scripts/affected-tests.sh",
    "env.RUN_BINARY == 'true' -> bun run build:binary",
  ]);
});
