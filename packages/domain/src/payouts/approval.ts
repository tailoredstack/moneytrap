import type { Id } from "../ids/ids";

// Maker-checker for a payout batch (DM-047, spec §4.1, TP-W7-016 to TP-W7-018). Pure: no clock, no I/O.
// The person who prepared a batch cannot approve it, and a batch moves to approved only from prepared, once. The store
// applies this same rule under the batch row lock, so the decision holds even when two requests race.

export type BatchApprovalState = "prepared" | "approved" | "cancelled";

export type ApprovalRefusal = "self_approval" | "cancelled" | "already_approved";

export type ApprovalDecision = { approved: true } | { approved: false; reason: ApprovalRefusal };

export function decideApproval(input: {
  state: BatchApprovalState;
  preparedBy: Id<"user">;
  approver: Id<"user">;
}): ApprovalDecision {
  // Checked before the state, so the preparer is told the rule that applies to them whatever the batch has become.
  if (input.approver === input.preparedBy) return { approved: false, reason: "self_approval" };
  switch (input.state) {
    case "prepared":
      return { approved: true };
    case "approved":
      return { approved: false, reason: "already_approved" };
    case "cancelled":
      return { approved: false, reason: "cancelled" };
  }
}
