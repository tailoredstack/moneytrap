import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { type AuditEntry, AuditTable } from "./audit-table";

const entries: AuditEntry[] = [
  {
    id: "audit_1",
    actor: { type: "staff", id: "usr_lee" },
    scope: "org_pub_1",
    action: "approve",
    reason: "DNS ok",
    occurredAt: "2026-10-31T10:20:00.000Z",
    object: { type: "property", id: "prop_1" },
  },
];

describe("AuditTable", () => {
  test("shows actor, scope, reason, timestamp, and object for each review decision", () => {
    const html = renderToStaticMarkup(<AuditTable entries={entries} />);
    for (const heading of ["When", "Actor", "Scope", "Action", "Reason", "Object"]) {
      expect(html).toContain(`>${heading}<`);
    }
    for (const value of ["usr_lee", "org_pub_1", "approve", "DNS ok", "property:prop_1", "2026-10-31T10:20:00.000Z"]) {
      expect(html).toContain(value);
    }
  });

  test("states when there are no decisions to show", () => {
    const html = renderToStaticMarkup(<AuditTable entries={[]} />);
    expect(html).toContain("No review decisions recorded.");
  });
});
