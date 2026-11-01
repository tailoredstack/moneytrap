import { describe, expect, test } from "bun:test";
import type { Id } from "../ids/ids";
import { decideApproval } from "./approval";

const maker = "usr_01arz3ndektsv4rrffq69g5fav" as Id<"user">;
const checker = "usr_01arz3ndektsv4rrffq69g5faw" as Id<"user">;

describe("decideApproval", () => {
  test("a different user approves a prepared batch (TP-W7-017)", () => {
    expect(decideApproval({ state: "prepared", preparedBy: maker, approver: checker })).toEqual({ approved: true });
  });

  test("the preparer cannot approve their own batch (TP-W7-016)", () => {
    expect(decideApproval({ state: "prepared", preparedBy: maker, approver: maker })).toEqual({
      approved: false,
      reason: "self_approval",
    });
  });

  test("a cancelled batch cannot be approved (TP-W7-018)", () => {
    expect(decideApproval({ state: "cancelled", preparedBy: maker, approver: checker })).toEqual({
      approved: false,
      reason: "cancelled",
    });
  });

  test("an approved batch is approved once", () => {
    expect(decideApproval({ state: "approved", preparedBy: maker, approver: checker })).toEqual({
      approved: false,
      reason: "already_approved",
    });
  });

  test("self-approval is refused whatever the state", () => {
    for (const state of ["prepared", "approved", "cancelled"] as const) {
      expect(decideApproval({ state, preparedBy: maker, approver: maker })).toEqual({
        approved: false,
        reason: "self_approval",
      });
    }
  });
});
