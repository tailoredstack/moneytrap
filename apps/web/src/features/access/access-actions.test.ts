import { describe, expect, test } from "bun:test";
import { canManageMembers, inviteMember, rejectInvitation } from "./access-actions";

function fakeClient(replies: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const calls: { method: string; input: unknown }[] = [];
  const reply = (method: string) => async (input: unknown) => {
    calls.push({ method, input });
    return replies[method] ?? { data: {}, error: null };
  };
  const client = {
    organization: {
      inviteMember: reply("inviteMember"),
      rejectInvitation: reply("rejectInvitation"),
    },
  } as unknown as Parameters<typeof inviteMember>[0];
  return { client, calls };
}

describe("canManageMembers (TP-W2-045)", () => {
  test("owners and admins may see and invite members", () => {
    expect(canManageMembers("owner")).toBe(true);
    expect(canManageMembers("admin")).toBe(true);
  });

  test("a plain member, or an unknown role, may not", () => {
    expect(canManageMembers("member")).toBe(false);
    expect(canManageMembers(null)).toBe(false);
    expect(canManageMembers(undefined)).toBe(false);
  });
});

describe("inviteMember (UI-011)", () => {
  test("sends the invitation through the Better Auth client with the chosen role", async () => {
    const { client, calls } = fakeClient();
    expect(await inviteMember(client, { email: "sam@example.com", role: "member" })).toEqual({ kind: "sent" });
    expect(calls).toEqual([{ method: "inviteMember", input: { email: "sam@example.com", role: "member" } }]);
  });

  test("a rejected address shows the server's message", async () => {
    const { client } = fakeClient({
      inviteMember: { data: null, error: { status: 400, message: "Email is not valid" } },
    });
    expect(await inviteMember(client, { email: "bad", role: "member" })).toEqual({
      kind: "invalid",
      message: "Email is not valid",
    });
  });

  test("any other failure is generic", async () => {
    const { client } = fakeClient({ inviteMember: { data: null, error: { status: 500 } } });
    expect(await inviteMember(client, { email: "sam@example.com", role: "member" })).toEqual({ kind: "failed" });
  });
});

describe("rejectInvitation (UI-014)", () => {
  test("declining sends the rejection and reports declined", async () => {
    const { client, calls } = fakeClient();
    expect(await rejectInvitation(client, "inv_1")).toEqual({ kind: "declined" });
    expect(calls).toEqual([{ method: "rejectInvitation", input: { invitationId: "inv_1" } }]);
  });

  test("a failed rejection is reported as failed, not as declined", async () => {
    const { client } = fakeClient({ rejectInvitation: { data: null, error: { status: 500 } } });
    expect(await rejectInvitation(client, "inv_1")).toEqual({ kind: "failed" });
  });
});
