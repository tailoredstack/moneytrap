// Membership and invitation calls go through the Better Auth client, like the identity actions.
import type { AuthError } from "../identity/identity-actions";

type Reply = { data?: unknown; error?: AuthError | null | undefined };

export type AccessClient = {
  organization: {
    inviteMember(input: { email: string; role: "admin" | "member" }): Promise<Reply>;
    rejectInvitation(input: { invitationId: string }): Promise<Reply>;
  };
};

// Better Auth lets any member list members. Only an owner or admin should see the list or invite.
export function canManageMembers(role: string | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export type InviteOutcome = { kind: "sent" } | { kind: "invalid"; message: string } | { kind: "failed" };

export async function inviteMember(
  client: AccessClient,
  input: { email: string; role: "admin" | "member" },
): Promise<InviteOutcome> {
  const { error } = await client.organization.inviteMember(input);
  if (!error) return { kind: "sent" };
  if (error.status === 400 || error.status === 422) {
    return { kind: "invalid", message: error.message ?? "Check the email address." };
  }
  return { kind: "failed" };
}

export type DeclineOutcome = { kind: "declined" } | { kind: "failed" };

export async function rejectInvitation(client: AccessClient, invitationId: string): Promise<DeclineOutcome> {
  const { error } = await client.organization.rejectInvitation({ invitationId });
  return error ? { kind: "failed" } : { kind: "declined" };
}
