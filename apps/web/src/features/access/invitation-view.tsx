import { Button } from "@moneytrap/ui";

// UI-014. The invitation names the organization and role. Each state offers only the actions that still apply.
export type InvitationState = "ready" | "already-member" | "expired";

export function InvitationView({
  state,
  orgName,
  memberRole,
  onAccept,
  onDecline,
}: {
  state: InvitationState;
  orgName: string;
  memberRole: "admin" | "member";
  onAccept?: () => void;
  onDecline?: () => void;
}) {
  const roleLabel = memberRole === "admin" ? "Admin" : "Member";
  if (state === "expired") {
    return (
      <section className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">Invitation</h1>
        <p role="status">This invitation has expired. Ask the organization to send a new one.</p>
      </section>
    );
  }
  if (state === "already-member") {
    return (
      <section className="max-w-sm space-y-2">
        <h1 className="text-xl font-semibold">Invitation</h1>
        <p role="status">You&apos;re already a member.</p>
        <a href="/overview" className="text-sm underline">
          Go to {orgName}
        </a>
      </section>
    );
  }
  return (
    <section className="max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">
        Join {orgName} as {roleLabel}
      </h1>
      <div className="flex gap-2">
        <Button onClick={onAccept}>Accept</Button>
        <Button variant="outline" onClick={onDecline}>
          Decline
        </Button>
      </div>
    </section>
  );
}
