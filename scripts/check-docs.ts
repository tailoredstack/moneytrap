// Checks cross-references and ID conventions across the Moneytrap docs.
// Run: bun scripts/check-docs.ts   (exit 1 on any problem)
//
// Add a check here whenever a review finds the same mistake twice.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const docsDir = join(root, "docs");
const errors: string[] = [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith(".md") ? [path] : [];
  });
}

const rel = (p: string) => p.slice(root.length + 1);
const files = walk(docsDir);
const isLegacy = (f: string) => f.includes(`${join("docs", "legacy")}`);
const read = (f: string) => readFileSync(f, "utf8");

// 1. Relative markdown links must resolve.
const linkRe = /\]\((?!https?:|mailto:|#)([^)\s#]+)(?:#[^)]*)?\)/g;
for (const f of files) {
  for (const m of read(f).matchAll(linkRe)) {
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) errors.push(`${rel(f)}: broken link -> ${m[1]}`);
  }
}

// 2. Definitions. Legacy docs define UC/API/DM/UI IDs as headings and CT IDs as table rows.
const defined = new Set<string>();
const headingIdRe = /^### ((?:UC\d{2})|(?:API|DM|UI)-\d{3})\b/gm;
const ctRowRe = /^\| (CT-\d{3}) \|/gm;
for (const f of files.filter(isLegacy)) {
  const text = read(f);
  for (const m of text.matchAll(headingIdRe)) defined.add(m[1]);
  for (const m of text.matchAll(ctRowRe)) defined.add(m[1]);
}

// Work packages: each WP is one table row in the implementation plan.
const planPath = join(docsDir, "implementation", "IMPLEMENTATION_PLAN.md");
const wpSeen = new Map<string, number>();
for (const m of read(planPath).matchAll(/^\| (WP-[\w]+\.\d+) \|/gm)) {
  wpSeen.set(m[1], (wpSeen.get(m[1]) ?? 0) + 1);
}
for (const [id, n] of wpSeen) {
  if (n > 1) errors.push(`IMPLEMENTATION_PLAN.md: duplicate definition of ${id}`);
  defined.add(id);
}

// ADRs: one file per decision, named ADR-NNN-<slug>.md, ending in Accepted or Rejected with a date.
const adrDir = join(docsDir, "adr");
const adrFiles = existsSync(adrDir) ? readdirSync(adrDir).filter((n) => /^ADR-\d{3}-.*\.md$/.test(n)) : [];
for (const name of adrFiles) {
  defined.add(name.slice(0, "ADR-NNN".length));
  const status = read(join(adrDir, name)).match(/^- Status: (?:Accepted|Rejected)\b.*?\d{4}-\d{2}-\d{2}/m);
  if (!status) errors.push(`docs/adr/${name}: status must be Accepted or Rejected, with a date`);
}
// ADRs the implementation plan reserves for later work packages. Each WP writes its own file.
for (const id of ["ADR-012", "ADR-013"]) defined.add(id);
for (const m of read(join(docsDir, "MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md")).matchAll(/^\| (ADR-\d{3}) \|/gm)) {
  if (!adrFiles.some((n) => n.startsWith(`${m[1]}-`))) errors.push(`Blueprint §11: ${m[1]} has no file in docs/adr/`);
}

// Test IDs: defined once each across all test plans.
const testSeen = new Map<string, string>();
for (const f of files.filter((f) => f.includes(join("test-plans", "wave-")))) {
  for (const m of read(f).matchAll(/^\| (TP-W\d+-\d{3}) \|/gm)) {
    const prev = testSeen.get(m[1]);
    if (prev) errors.push(`${m[1]} defined in both ${prev} and ${rel(f)}`);
    testSeen.set(m[1], rel(f));
  }
}
for (const id of testSeen.keys()) defined.add(id);

// 3. Every reference in non-legacy docs must point at something defined.
const refRe = /\b(UC\d{2}|API-\d{3}|DM-\d{3}|UI-\d{3}|CT-\d{3}|WP-\d+\.\d+|WP-X\.\d+|TP-W\d+-\d{3}|ADR-\d{3})\b/g;
for (const f of files.filter((f) => !isLegacy(f))) {
  for (const m of read(f).matchAll(refRe)) {
    if (!defined.has(m[1])) errors.push(`${rel(f)}: reference to undefined ${m[1]}`);
  }
}

if (errors.length) {
  console.error(`check-docs: ${errors.length} problem(s)\n`);
  for (const e of [...new Set(errors)]) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `check-docs: ok (${files.length} files, ${defined.size} IDs, ${wpSeen.size} work packages, ${testSeen.size} test IDs)`,
);
