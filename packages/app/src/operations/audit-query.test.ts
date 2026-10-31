import { describe, expect, test } from "bun:test";
import { type AuditLogRow, REVIEW_DECISION_ACTIONS, toReviewDecisionEntry } from "./audit-query";

const row: AuditLogRow = {
  id: "audit_1",
  organization_id: "org_pub_1",
  actor_type: "staff",
  actor_id: "usr_lee",
  action: "approve",
  entity_type: "property",
  entity_id: "prop_1",
  metadata: { reason: "DNS ok" },
  occurred_at: new Date("2026-10-31T10:20:00.000Z"),
};

describe("toReviewDecisionEntry", () => {
  test("maps an audit row to the actor, scope, reason, timestamp, and object of a review decision", () => {
    expect(toReviewDecisionEntry(row)).toEqual({
      id: "audit_1",
      actor: { type: "staff", id: "usr_lee" },
      scope: "org_pub_1",
      action: "approve",
      reason: "DNS ok",
      occurredAt: "2026-10-31T10:20:00.000Z",
      object: { type: "property", id: "prop_1" },
    });
  });

  test("keeps a null reason and a null actor id instead of inventing values", () => {
    const entry = toReviewDecisionEntry({ ...row, actor_id: null, metadata: {} });
    expect(entry.actor).toEqual({ type: "staff", id: null });
    expect(entry.reason).toBeNull();
  });
});

describe("REVIEW_DECISION_ACTIONS", () => {
  test("lists the decision actions shown in the audit viewer", () => {
    expect([...REVIEW_DECISION_ACTIONS]).toEqual(["approve", "reject", "suspend", "reinstate"]);
  });
});
