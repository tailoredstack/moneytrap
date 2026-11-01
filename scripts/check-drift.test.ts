import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  CONFORMANCE_CATALOG,
  CONTRACT_VERSION_FILE,
  changedCaseIds,
  checkVersionDrift,
  collectDrift,
  compareVersions,
  parseContractVersion,
  parseSpecVersion,
  SPEC_VERSION_FILE,
  selectConformance,
} from "./check-drift";

const none = { base: "2.0", head: "2.0" };

describe("parsing", () => {
  test("reads the spec version token and ignores the note after it", () => {
    expect(parseSpecVersion("# T\n\n**Version:** 2.0 (baseline)  \n**Status:** x")).toBe("2.0");
  });
  test("returns null without a version line", () => {
    expect(parseSpecVersion("# T\n\nVersion 2.0")).toBeNull();
  });
  test("reads the contract package version", () => {
    expect(parseContractVersion('{"name":"c","version":"1.2.3"}')).toBe("1.2.3");
    expect(parseContractVersion('{"name":"c"}')).toBeNull();
    expect(parseContractVersion("not json")).toBeNull();
  });
  test("compares numeric versions part by part", () => {
    expect(compareVersions("2.1", "2.0")).toBeGreaterThan(0);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("1.9", "1.10")).toBeLessThan(0);
    expect(compareVersions("2.0-rc1", "2.0")).toBeNull();
  });
});

describe("version drift", () => {
  const specChange = ["docs/legacy/MONEYTRAP_API_OPERATIONS.md"];

  test("passes when nothing guarded changed", () => {
    expect(checkVersionDrift({ changed: ["apps/server/src/index.ts"], spec: none, contract: none })).toEqual([]);
  });
  test("fails a spec change without a bump", () => {
    const errors = checkVersionDrift({ changed: specChange, spec: none, contract: none });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("spec changed");
    expect(errors[0]).toContain("without a version bump");
  });
  test("passes a spec change with a bump", () => {
    expect(checkVersionDrift({ changed: specChange, spec: { base: "2.0", head: "2.1" }, contract: none })).toEqual([]);
  });
  test("fails a spec change that lowers the version", () => {
    expect(checkVersionDrift({ changed: specChange, spec: { base: "2.1", head: "2.0" }, contract: none })).toHaveLength(
      1,
    );
  });
  test("fails when the version line was removed", () => {
    const errors = checkVersionDrift({ changed: specChange, spec: { base: "2.0", head: null }, contract: none });
    expect(errors[0]).toContain("no readable version");
  });
  test("fails a version that cannot be compared", () => {
    const errors = checkVersionDrift({ changed: specChange, spec: { base: "2.0", head: "2.1-rc1" }, contract: none });
    expect(errors[0]).toContain("not numeric");
  });
  test("editing the spec file without moving its version fails", () => {
    expect(checkVersionDrift({ changed: [SPEC_VERSION_FILE], spec: none, contract: none })).toHaveLength(1);
  });
  test("a base spec with no version line reads as 0, so a head version of 0 is no bump", () => {
    expect(checkVersionDrift({ changed: specChange, spec: { base: "0", head: "0" }, contract: none })).toHaveLength(1);
  });
  test("bumping the version in the spec file itself passes", () => {
    expect(
      checkVersionDrift({ changed: [SPEC_VERSION_FILE], spec: { base: "2.0", head: "2.1" }, contract: none }),
    ).toEqual([]);
  });
  test("a non-markdown file under the spec directory is a spec change", () => {
    expect(checkVersionDrift({ changed: ["docs/legacy/diagram.png"], spec: none, contract: none })).toHaveLength(1);
  });
  test("fails a contract source change without a bump", () => {
    const errors = checkVersionDrift({
      changed: ["packages/contracts/src/money.ts"],
      spec: none,
      contract: { base: "0.0.0", head: "0.0.0" },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("contract changed");
  });
  test("passes a contract source change with a bump", () => {
    expect(
      checkVersionDrift({
        changed: ["packages/contracts/src/money.ts", CONTRACT_VERSION_FILE],
        spec: none,
        contract: { base: "0.0.0", head: "0.1.0" },
      }),
    ).toEqual([]);
  });
  test("contract tests do not need a bump", () => {
    expect(
      checkVersionDrift({ changed: ["packages/contracts/src/money.test.ts"], spec: none, contract: none }),
    ).toEqual([]);
  });
  test("reports spec and contract drift together", () => {
    const errors = checkVersionDrift({
      changed: [...specChange, "packages/contracts/src/error.ts"],
      spec: none,
      contract: none,
    });
    expect(errors).toHaveLength(2);
  });
  test("a version file that is new on the branch has nothing to compare against", () => {
    expect(checkVersionDrift({ changed: specChange, spec: { base: null, head: "1.0" }, contract: none })).toEqual([]);
  });
});

describe("conformance selection", () => {
  const diff = [
    "--- a/docs/legacy/MONEYTRAP_CONFORMANCE_CASES.md",
    "+++ b/docs/legacy/MONEYTRAP_CONFORMANCE_CASES.md",
    "@@ -10 +10 @@",
    "-| CT-004 | Prior sessions | Password changed | Old rule |",
    "+| CT-004 | Prior sessions | Password changed | New rule |",
    "+| CT-099 | Given | When | Must |",
    " | CT-005 | context row | | |",
    "+Some prose mentioning CT-006 is not a row.",
  ].join("\n");

  test("collects IDs from added and removed table rows only", () => {
    expect(changedCaseIds(diff)).toEqual(["CT-004", "CT-099"]);
  });

  const sources = new Map([
    ["packages/conformance/src/ct/identity.test.ts", 'describe("CT-004 prior sessions", () => {})'],
    ["packages/conformance/src/ct/links.test.ts", 'test("CT-0041 other", () => {})'],
  ]);

  test("selects the tests that name a touched case and reports the rest", () => {
    expect(selectConformance([], ["CT-004", "CT-099"], sources)).toEqual({
      tests: ["packages/conformance/src/ct/identity.test.ts"],
      uncovered: ["CT-099"],
    });
  });
  test("a changed conformance test is always selected", () => {
    const selection = selectConformance(["packages/conformance/src/ct/links.test.ts"], [], sources);
    expect(selection.tests).toEqual(["packages/conformance/src/ct/links.test.ts"]);
  });
  test("a deleted conformance test is not selected", () => {
    expect(selectConformance(["packages/conformance/src/ct/gone.test.ts"], [], sources).tests).toEqual([]);
  });
});

describe("against a real git branch", () => {
  let repo: string;
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const write = (path: string, content: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  };
  const commit = (message: string) => {
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", message);
  };
  const specText = (version: string, body = "rule") => `# Spec\n\n**Version:** ${version} (note)\n\n${body}\n`;
  const contractJson = (version: string) => `{"name":"@moneytrap/contracts","version":"${version}"}\n`;

  beforeEach(() => {
    repo = mkdtempSync(join(resolve(tmpdir()), "drift-"));
    git("init", "-q", "-b", "main");
    write(SPEC_VERSION_FILE, specText("2.0"));
    write("docs/legacy/MONEYTRAP_API_OPERATIONS.md", "# API\n");
    write(CONFORMANCE_CATALOG, "| ID | Given |\n| CT-001 | a |\n| CT-002 | b |\n");
    write(CONTRACT_VERSION_FILE, contractJson("0.0.0"));
    write("packages/contracts/src/money.ts", "export const a = 1;\n");
    write("packages/conformance/src/ct/identity.test.ts", '// CT-001\nimport { test } from "bun:test";\n');
    commit("base");
    git("checkout", "-q", "-b", "feature");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("an untouched branch passes", () => {
    expect(collectDrift(repo, "main").errors).toEqual([]);
  });
  test("a committed spec change without a bump fails", () => {
    write("docs/legacy/MONEYTRAP_API_OPERATIONS.md", "# API\n\nnew rule\n");
    commit("spec change");
    const { errors } = collectDrift(repo, "main");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("without a version bump");
  });
  test("a spec change with a bump passes", () => {
    write("docs/legacy/MONEYTRAP_API_OPERATIONS.md", "# API\n\nnew rule\n");
    write(SPEC_VERSION_FILE, specText("2.1"));
    commit("spec change and bump");
    expect(collectDrift(repo, "main").errors).toEqual([]);
  });
  test("a spec file deleted on the branch counts as a spec change", () => {
    git("rm", "-q", "docs/legacy/MONEYTRAP_API_OPERATIONS.md");
    commit("delete spec file");
    expect(collectDrift(repo, "main").errors).toHaveLength(1);
  });
  test("an untracked conformance catalog selects every case it names", () => {
    git("checkout", "-q", "main");
    git("rm", "-q", CONFORMANCE_CATALOG);
    commit("main has no catalog yet");
    git("checkout", "-q", "-b", "other");
    write(SPEC_VERSION_FILE, specText("2.1"));
    write(CONFORMANCE_CATALOG, "| ID | Given |\n| CT-001 | a |\n");
    expect(collectDrift(repo, "main").tests).toEqual(["packages/conformance/src/ct/identity.test.ts"]);
  });
  test("an untracked new spec file is seen", () => {
    write("docs/legacy/NEW_SPEC.md", "# New\n");
    expect(collectDrift(repo, "main").errors).toHaveLength(1);
  });
  test("a spec path with non-ASCII characters is not skipped", () => {
    write("docs/legacy/spéc.md", "# Accent\n");
    commit("accented spec file");
    expect(collectDrift(repo, "main").errors).toHaveLength(1);
  });
  test("a base spec with no version line counts as version 0", () => {
    git("checkout", "-q", "main");
    write(SPEC_VERSION_FILE, "# Spec without a version\n");
    commit("drop version");
    git("checkout", "-q", "feature");
    git("merge", "-q", "--ff-only", "main");
    write(SPEC_VERSION_FILE, specText("1.0"));
    commit("add version");
    expect(collectDrift(repo, "main").errors).toEqual([]);
  });
  test("an uncommitted spec change is seen too", () => {
    write("docs/legacy/MONEYTRAP_API_OPERATIONS.md", "# API\n\nnew rule\n");
    expect(collectDrift(repo, "main").errors).toHaveLength(1);
  });
  test("a contract change without a bump fails, and with a bump passes", () => {
    write("packages/contracts/src/money.ts", "export const a = 2;\n");
    commit("contract change");
    expect(collectDrift(repo, "main").errors).toHaveLength(1);
    write(CONTRACT_VERSION_FILE, contractJson("0.1.0"));
    commit("bump");
    expect(collectDrift(repo, "main").errors).toEqual([]);
  });
  test("drift is measured from the merge base when main moved on", () => {
    git("checkout", "-q", "main");
    write(SPEC_VERSION_FILE, specText("2.5", "other branch rule"));
    commit("main moves on");
    git("checkout", "-q", "feature");
    write("docs/unrelated.md", "x\n");
    commit("unrelated");
    expect(collectDrift(repo, "main").errors).toEqual([]);
  });
  test("a changed catalog row selects the conformance test that names it", () => {
    write(CONFORMANCE_CATALOG, "| ID | Given |\n| CT-001 | changed |\n| CT-002 | b |\n");
    write(SPEC_VERSION_FILE, specText("2.1"));
    commit("catalog change");
    const report = collectDrift(repo, "main");
    expect(report.errors).toEqual([]);
    expect(report.tests).toEqual(["packages/conformance/src/ct/identity.test.ts"]);
    expect(report.uncovered).toEqual([]);
  });
  test("a changed row with no test is reported as uncovered", () => {
    write(CONFORMANCE_CATALOG, "| ID | Given |\n| CT-001 | a |\n| CT-002 | changed |\n");
    write(SPEC_VERSION_FILE, specText("2.1"));
    commit("catalog change");
    expect(collectDrift(repo, "main").uncovered).toEqual(["CT-002"]);
  });
  test("an unknown base fails loudly instead of passing", () => {
    expect(() => collectDrift(repo, "origin/nope")).toThrow("cannot find a merge base");
  });
});
