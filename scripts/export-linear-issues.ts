// Turns the work packages in IMPLEMENTATION_PLAN.md into a CSV that Linear can import.
// Run: bun scripts/export-linear-issues.ts > docs/implementation/linear-issues.csv
//
// One issue per work package. Wave becomes the label and the project name.

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const planPath = join(root, "docs", "implementation", "IMPLEMENTATION_PLAN.md");
const rows = readFileSync(planPath, "utf8").split("\n").filter((l) => /^\| WP-/.test(l));

const cells = (row: string) => row.split(" | ").map((c) => c.replace(/^\| ?/, "").replace(/ ?\|$/, "").trim());
const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

const header = ["Title", "Description", "Project", "Labels", "Priority", "Status"];
const out = [header.join(",")];

for (const row of rows) {
  const [id, title, lane, dependsOn, paths, specRefs, doneWhen] = cells(row);
  if (!id || !title) continue;
  const wave = id.startsWith("WP-X") ? "cross-cutting" : `wave-${id.replace("WP-", "").split(".")[0]}`;
  const description = [
    `**Lane:** ${lane}`,
    `**Depends on:** ${dependsOn}`,
    `**Paths:** ${paths}`,
    `**Spec refs:** ${specRefs}`,
    `**Done when:** ${doneWhen}`,
    `**Plan:** docs/implementation/IMPLEMENTATION_PLAN.md`,
  ].join("\n\n");
  const labels = [wave, `lane-${lane}`].filter((l) => !l.startsWith("lane--")).join(";");
  out.push(
    [`${id} ${title}`, description, "Moneytrap", labels, "3", "Backlog"].map(csv).join(","),
  );
}

console.log(out.join("\n"));
