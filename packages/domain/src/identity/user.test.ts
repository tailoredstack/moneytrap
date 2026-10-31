import { describe, expect, test } from "bun:test";
import { type Id, parseId } from "../ids/ids";
import { assertPrivilegedAllowed, closeUser, registerUser, reinstateUser, suspendUser, verifyUser } from "./user";

const userId = parseId("user", "usr_00000000000000000000000000") as Id<"user">;

function pendingUser() {
  return registerUser({ id: userId, email: "ada@example.com" });
}

function activeUser() {
  const result = verifyUser(pendingUser());
  if (!result.ok) throw new Error("fixture: verify failed");
  return result.value;
}

describe("User state machine", () => {
  test("DM-001 registration starts pending with the email and id", () => {
    const user = pendingUser();
    expect(user).toEqual({ id: userId, email: "ada@example.com", status: "pending" });
  });

  test("TP-W2-001 pending → active on verify", () => {
    const result = verifyUser(pendingUser());
    expect(result).toEqual({
      ok: true,
      value: { id: userId, email: "ada@example.com", status: "active" },
    });
  });

  test("active → suspended and suspended → active (reinstate)", () => {
    const suspended = suspendUser(activeUser());
    expect(suspended.ok && suspended.value.status).toBe("suspended");
    if (!suspended.ok) return;
    const reinstated = reinstateUser(suspended.value);
    expect(reinstated.ok && reinstated.value.status).toBe("active");
  });

  test("pending and active can close; closed is terminal", () => {
    const fromPending = closeUser(pendingUser());
    expect(fromPending.ok && fromPending.value.status).toBe("closed");
    const fromActive = closeUser(activeUser());
    expect(fromActive.ok && fromActive.value.status).toBe("closed");
  });

  test("TP-W2-002 closed → active is rejected with STATE_CONFLICT", () => {
    const closed = closeUser(activeUser());
    if (!closed.ok) throw new Error("fixture: close failed");
    expect(reinstateUser(closed.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(verifyUser(closed.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("illegal transitions are rejected with STATE_CONFLICT", () => {
    expect(verifyUser(activeUser())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(suspendUser(pendingUser())).toEqual({ ok: false, code: "STATE_CONFLICT" });
    expect(reinstateUser(activeUser())).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("closing twice is rejected", () => {
    const closed = closeUser(pendingUser());
    if (!closed.ok) throw new Error("fixture: close failed");
    expect(closeUser(closed.value)).toEqual({ ok: false, code: "STATE_CONFLICT" });
  });

  test("TP-W2-003 privileged action on a pending user is rejected", () => {
    expect(assertPrivilegedAllowed(pendingUser())).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  test("privileged actions are allowed only when active", () => {
    expect(assertPrivilegedAllowed(activeUser())).toEqual({ ok: true });
    const suspended = suspendUser(activeUser());
    if (!suspended.ok) throw new Error("fixture: suspend failed");
    expect(assertPrivilegedAllowed(suspended.value)).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  test("transitions return new values and never mutate the input", () => {
    const pending = pendingUser();
    verifyUser(pending);
    expect(pending.status).toBe("pending");
  });
});
