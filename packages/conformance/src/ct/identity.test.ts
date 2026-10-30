import { describe, test } from "bun:test";

// Milestone M1 (waves 1-2): identity, access, and recovery.
describe("[M1] identity conformance", () => {
  test.todo("[M1] CT-001 unknown identity hint: recovery requested");
  test.todo("[M1] CT-002 valid recovery proof: two concurrent redemptions");
  test.todo("[M1] CT-003 expired recovery proof: redemption attempted");
  test.todo("[M1] CT-004 prior active sessions: password changed through recovery");
  test.todo("[M1] CT-005 user with membership in org A only: org B resource requested");
  test.todo("[M1] CT-008 valid but reused invitation: reaccepted");
});
