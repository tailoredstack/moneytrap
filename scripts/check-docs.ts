// Checks cross-references and ID conventions across the Moneytrap docs.
// Run: bun scripts/check-docs.ts   (exit 1 on any problem)
//
// Add a check here whenever a review finds the same mistake twice.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

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
// The review comment template uses placeholder link targets, so it is exempt from link and reference checks.
const reviewTemplate = join(docsDir, "MONEYTRAP_REVIEW.md");
const files = walk(docsDir).filter((f) => f !== reviewTemplate);
const legacyDir = join(docsDir, "legacy") + sep;
const isLegacy = (f: string) => f.startsWith(legacyDir);
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
for (const m of read(planPath).matchAll(/^\| (WP-[\w]+\.\d+[a-z]?) \|/gm)) {
  wpSeen.set(m[1], (wpSeen.get(m[1]) ?? 0) + 1);
}
for (const [id, n] of wpSeen) {
  if (n > 1) errors.push(`IMPLEMENTATION_PLAN.md: duplicate definition of ${id}`);
  defined.add(id);
}

// ADRs: docs/adr holds README.md plus one file per decision, named ADR-NNN-<slug>.md.
// The first Status line must be "Accepted, <date>" or "Rejected, <date>", with a real calendar date.
const adrDir = join(docsDir, "adr");
// Every entry in docs/adr except README.md must be a file named ADR-NNN-<slug>.md. Subdirectories fail.
// Finder's .DS_Store file is ignored. A directory with that name is not Finder metadata, so it fails.
// A symlink named .DS_Store is not a file, so it is kept and fails the naming rule.
const adrEntries = existsSync(adrDir)
  ? readdirSync(adrDir, { withFileTypes: true }).filter((e) => e.name !== ".DS_Store" || !e.isFile())
  : [];
const adrNames = adrEntries.filter((e) => e.isFile() && e.name !== "README.md").map((e) => e.name);
const adrFiles = adrNames.filter((n) => /^ADR-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(n));
for (const entry of adrEntries) {
  if (entry.name === "README.md" && entry.isFile()) continue;
  if (!entry.isFile() || !adrFiles.includes(entry.name)) {
    errors.push(`docs/adr/${entry.name}: must be a file named ADR-NNN-<slug>.md`);
  }
}
const adrStatus = new Map<string, string>();
const adrIdCount = new Map<string, number>();
for (const name of adrFiles) {
  const id = name.slice(0, "ADR-NNN".length);
  defined.add(id);
  adrIdCount.set(id, (adrIdCount.get(id) ?? 0) + 1);
  const statuses = [...read(join(adrDir, name)).matchAll(/^- Status: (.*)$/gm)];
  const status = /^(Accepted|Rejected), (\d{4}-\d{2}-\d{2})(?:\s|\(|$)/.exec(statuses[0]?.[1] ?? "");
  // Round-trip the date so impossible days (2026-02-30) and months (2026-13-01) fail without throwing.
  const parsed = status ? Date.parse(`${status[2]}T00:00:00Z`) : Number.NaN;
  const realDate = !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === status?.[2];
  if (statuses.length !== 1 || !status || !realDate) {
    errors.push(`docs/adr/${name}: status must be one "Accepted, <date>" or "Rejected, <date>" line`);
  } else {
    adrStatus.set(id, `${status[1]}, ${status[2]}`);
  }
}
// ADRs the implementation plan reserves for later work packages. Each WP writes its own file.
for (const id of ["ADR-012", "ADR-013"]) defined.add(id);
// Blueprint §11 must list each ADR, with a file whose status matches the table.
for (const [id, n] of adrIdCount) if (n > 1) errors.push(`docs/adr: ${id} is defined by ${n} files`);
const blueprint = read(join(docsDir, "MONEYTRAP_IMPLEMENTATION_BLUEPRINT.md"));
const sec11Start = blueprint.indexOf("## 11.");
const sec11End = blueprint.indexOf("## 12.");
if (sec11Start < 0 || sec11End < sec11Start) {
  errors.push("Blueprint: section 11 heading not found, so ADR status rows cannot be checked");
}
const section11 = sec11Start < 0 || sec11End < sec11Start ? "" : blueprint.slice(sec11Start, sec11End);
const listedInSection11 = new Set<string>();
for (const m of section11.matchAll(/^\| \**(ADR-\d{3})\** \| .* \| (.*?) \|\s*$/gm)) {
  listedInSection11.add(m[1]);
  // Compare the status and date, ignoring any parenthetical note after them.
  const tableStatus = /^((?:Accepted|Rejected), \d{4}-\d{2}-\d{2})(?:\s|\(|$)/.exec(m[2])?.[1];
  const fileStatus = adrStatus.get(m[1]);
  if (!adrFiles.some((n) => n.startsWith(`${m[1]}-`))) errors.push(`Blueprint §11: ${m[1]} has no file in docs/adr/`);
  else if (tableStatus !== fileStatus) errors.push(`Blueprint §11: ${m[1]} status "${m[2]}" differs from its ADR file`);
}
for (const name of adrFiles) {
  const id = name.slice(0, "ADR-NNN".length);
  if (!listedInSection11.has(id)) errors.push(`Blueprint §11: ${id} (${name}) has no row`);
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
// Each reference captures the whole token, including trailing letters, so UC123 or WP-0.8a is checked as written.
// Matches are not bounded by \b, which treats underscore as a word character. Lookbehind rejects a letter or digit
// directly before the token instead.
const refRe =
  /(?<![\p{L}\p{N}])(?:UC\d+|API-\d+|DM-\d+|UI-\d+|CT-\d+|WP-\d+\.\d+|WP-[A-Z]\.\d+|TP-W\d+-\d+)[\p{L}\p{N}]*/gu;
// Prose ADR references in any case. Any run of characters other than letters or digits may sit between ADR and the
// number, including newlines. NFKC folds fullwidth letters and digits to ASCII first. Trailing letters stay in the
// captured number, so ADR-999a is an ID that does not exist and fails.
const adrRefRe = /(?<![\p{L}\p{N}])ADR[^\p{L}\p{N}]*(\p{N}[\p{L}\p{N}]*)/giu;
for (const f of files.filter((f) => !isLegacy(f))) {
  const text = read(f).normalize("NFKC");
  for (const m of text.matchAll(refRe)) {
    if (!defined.has(m[0])) errors.push(`${rel(f)}: reference to undefined ${m[0]}`);
  }
  for (const m of text.matchAll(adrRefRe)) {
    const id = `ADR-${m[1]}`;
    if (!defined.has(id)) errors.push(`${rel(f)}: reference to undefined ${id}`);
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
